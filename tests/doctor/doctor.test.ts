import { describe, expect, it } from 'vitest';
import { buildDoctorReport, doctorSafeEvidence, type DoctorInput } from '../../src/main/doctor';

const base: DoctorInput = {
  now: '2026-09-01T00:00:00.000Z',
  runtime: { node: '22.14.0', electron: '34.0.0', pnpm: '11.7.0', electronLaunched: true },
  environment: { electronRunAsNode: false, wbElectronArgs: false, nodeOptions: false },
  projectRoots: [{ projectId: 'demo', rootLabel: 'demo-root', exists: true }],
  harnesses: [
    { harness: 'codex', available: true, evidence: 'Codex app-server initialized', protocol: 'app-server' },
    { harness: 'claude', available: true, evidence: 'Claude stream-json available', protocol: 'stream-json' },
    { harness: 'deepseek', available: false, evidence: 'no stable structured interface', protocol: 'none' },
  ],
  state: { writable: true, writableReason: 'existing state directory permits writes', integrityReadable: true, isolatedProblems: 0, inspectedFrozenScopes: 2, scanTruncated: false },
  profile: { valid: true, bindings: 1, unresolved: 0, missingRoots: 0 },
  material: { requested: 'system', effective: 'glass', fallbackReason: null },
  singleInstance: true,
};

describe('bounded read-only Doctor report', () => {
  it('reports every required seam with provenance and honest DeepSeek degradation', () => {
    const report = buildDoctorReport(base);
    expect(report.readOnly).toBe(true);
    expect(report.bounded).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      'runtime.node', 'runtime.pnpm', 'runtime.electron',
      'environment.electron-run-as-node', 'environment.wb-electron-args', 'environment.node-options',
      'project-roots', 'harness.codex', 'harness.claude', 'harness.deepseek',
      'state.writable', 'state.integrity', 'profile.portability', 'material.capability', 'app.single-instance',
    ]);
    expect(report.checks.every((check) => check.provenance.length > 0 && check.reason.length > 0)).toBe(true);
    expect(report.checks.find((check) => check.id === 'harness.deepseek')?.status).toBe('WARN');
  });

  it('fails closed on contaminated launch mode, missing roots, invalid profile, and unreadable state', () => {
    const report = buildDoctorReport({
      ...base,
      environment: { electronRunAsNode: true, wbElectronArgs: true, nodeOptions: true },
      projectRoots: [{ projectId: 'demo', rootLabel: 'demo-root', exists: false }],
      state: { ...base.state, writable: false, integrityReadable: false, writableReason: 'access denied' },
      profile: { valid: false, bindings: 0, unresolved: 1, missingRoots: 1 },
    });
    const status = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(status['environment.electron-run-as-node']).toBe('FAIL');
    expect(status['environment.wb-electron-args']).toBe('WARN');
    expect(status['environment.node-options']).toBe('WARN');
    expect(status['project-roots']).toBe('FAIL');
    expect(status['state.writable']).toBe('FAIL');
    expect(status['state.integrity']).toBe('FAIL');
    expect(status['profile.portability']).toBe('FAIL');
  });

  it('never exposes environment contents or absolute roots', () => {
    const report = buildDoctorReport({
      ...base,
      projectRoots: [{ projectId: 'secret-project', rootLabel: 'configured local root', exists: true }],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toMatch(/[A-Z]:\\/i);
    expect(doctorSafeEvidence('Bearer secret JWT eyJhbGciOiJIUzI1NiJ9 C:\\Users\\name\\secret')).toBe('adapter returned evidence; raw external output withheld');
    expect(doctorSafeEvidence('initialize.userAgent=codex-cli/1.2.3; token=secret')).toBe('userAgent=codex-cli/1.2.3');
  });

  it('withholds arbitrary external stdout, env, token and path text from harness evidence', () => {
    const hostile = [
      'sk-ant-api03-REDACTEDVALUE0000000000',
      'C:\\Users\\victim\\.codex\\auth.json',
      '/home/victim/.claude/settings.json',
      'OPENAI_API_KEY=live-key-0123456789',
      'stack: Error: EACCES at Object.<anonymous> (/usr/lib/node_modules/x/index.js:12:5)',
    ].join(' | ');
    const report = buildDoctorReport({
      ...base,
      harnesses: [
        { harness: 'codex', available: true, evidence: hostile, protocol: hostile },
        { harness: 'claude', available: true, evidence: `claude --version 1.0.42 ${hostile}`, protocol: hostile },
        { harness: 'deepseek', available: false, evidence: hostile, protocol: hostile },
      ],
    });
    const serialized = JSON.stringify(report);
    for (const secret of [
      'sk-ant-api03-REDACTEDVALUE0000000000', 'victim', 'auth.json', 'settings.json',
      'live-key-0123456789', 'EACCES', 'node_modules',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/[A-Za-z]:\\[^"\\]*\\/);
    // allowlisted capability facts survive
    expect(report.checks.find((check) => check.id === 'harness.claude')?.reason).toContain('version=1.0.42');
    for (const harness of ['codex', 'claude', 'deepseek']) {
      expect(report.checks.find((check) => check.id === `harness.${harness}`)?.reason)
        .toContain('protocol declared by');
    }
  });

  it('warns on a truncated scan without claiming an unreadable state store', () => {
    const report = buildDoctorReport({
      ...base,
      state: { ...base.state, integrityReadable: true, isolatedProblems: 0, scanTruncated: true },
      projectRootsTruncated: true,
      profile: { ...base.profile, scanTruncated: true },
    });
    const status = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    // capped scans are WARN-level truncation, never a FAIL that implies corruption
    expect(status['state.integrity']).toBe('WARN');
    expect(status['project-roots']).toBe('WARN');
    expect(status['profile.portability']).toBe('WARN');
    expect(report.checks.find((check) => check.id === 'state.integrity')?.reason).toContain('scan capped');
  });
});
