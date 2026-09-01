export type DoctorStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  reason: string;
  provenance: string;
}

export interface DoctorInput {
  now: string;
  runtime: { node?: string; electron?: string; pnpm?: string; electronLaunched: boolean };
  environment: { electronRunAsNode: boolean; wbElectronArgs: boolean; nodeOptions: boolean };
  projectRoots: { projectId: string; rootLabel: string; exists: boolean }[];
  projectRootsTruncated?: boolean;
  harnesses: { harness: string; available: boolean; evidence: string; protocol: string }[];
  state: {
    writable: boolean;
    writableReason: string;
    integrityReadable: boolean;
    isolatedProblems: number;
    inspectedFrozenScopes: number;
    scanTruncated: boolean;
  };
  profile: { valid: boolean; bindings: number; unresolved: number; missingRoots: number; scanTruncated?: boolean };
  material: { requested: string; effective: string; fallbackReason: string | null };
  singleInstance: boolean;
}

export interface DoctorReport {
  generatedAt: string;
  readOnly: true;
  bounded: true;
  checks: DoctorCheck[];
}

const check = (
  id: string,
  label: string,
  status: DoctorStatus,
  reason: string,
  provenance: string,
): DoctorCheck => ({ id, label, status, reason, provenance });

export function doctorSafeEvidence(value: string): string {
  const facts: string[] = [];
  const userAgent = /initialize\.userAgent=([A-Za-z0-9._/-]{1,80})/.exec(value)?.[1];
  const claudeVersion = /claude --version\s+([A-Za-z0-9._-]{1,40})/i.exec(value)?.[1];
  const streamJson = /stream-json=(yes|no)/i.exec(value)?.[1];
  if (userAgent) facts.push(`userAgent=${userAgent}`);
  if (claudeVersion) facts.push(`version=${claudeVersion}`);
  if (streamJson) facts.push(`stream-json=${streamJson.toLowerCase()}`);
  if (/unavailable|not found|spawn error/i.test(value)) facts.push('adapter reported unavailable');
  if (/no stable structured interface/i.test(value)) facts.push('no stable structured interface');
  return facts.join('; ') || 'adapter returned evidence; raw external output withheld';
}

function atLeast(version: string | undefined, expected: [number, number]): boolean | null {
  if (!version) return null;
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > expected[0] || (major === expected[0] && minor >= expected[1]);
}

export function buildDoctorReport(input: DoctorInput): DoctorReport {
  const checks: DoctorCheck[] = [];
  const nodeCompatible = atLeast(input.runtime.node, [22, 13]);
  checks.push(check(
    'runtime.node', 'Node compatibility',
    nodeCompatible === null ? 'UNKNOWN' : nodeCompatible ? 'PASS' : 'FAIL',
    input.runtime.node ? `Node ${input.runtime.node}; package requirement is >=22.13` : 'Node version was not reported',
    'process.versions.node + package.json engines',
  ));
  const pnpmCompatible = atLeast(input.runtime.pnpm, [11, 7]);
  checks.push(check(
    'runtime.pnpm', 'pnpm compatibility',
    pnpmCompatible === null ? 'UNKNOWN' : pnpmCompatible ? 'PASS' : 'WARN',
    input.runtime.pnpm ? `pnpm ${input.runtime.pnpm}; repository package manager is pnpm@11.7.0` : 'pnpm executable/version unavailable; packaged runtime does not depend on pnpm',
    'bounded pnpm --version probe + package.json packageManager',
  ));
  checks.push(check(
    'runtime.electron', 'Electron launch',
    input.runtime.electronLaunched && input.runtime.electron ? 'PASS' : 'FAIL',
    input.runtime.electronLaunched ? `Electron ${input.runtime.electron ?? 'UNKNOWN'} main and renderer are running` : 'Electron launch was not confirmed',
    'active Electron main-process IPC',
  ));
  checks.push(check(
    'environment.electron-run-as-node', 'ELECTRON_RUN_AS_NODE',
    input.environment.electronRunAsNode ? 'FAIL' : 'PASS',
    input.environment.electronRunAsNode ? 'Variable is set; Electron launch semantics are contaminated (value withheld)' : 'Variable is not set',
    'environment presence check; contents never returned',
  ));
  checks.push(check(
    'environment.wb-electron-args', 'WB_ELECTRON_ARGS',
    input.environment.wbElectronArgs ? 'WARN' : 'PASS',
    input.environment.wbElectronArgs ? 'Workbench Electron argument override is set (value withheld)' : 'No Workbench Electron argument override',
    'environment presence check; contents never returned',
  ));
  checks.push(check(
    'environment.node-options', 'NODE_OPTIONS',
    input.environment.nodeOptions ? 'WARN' : 'PASS',
    input.environment.nodeOptions ? 'Node runtime options are set and may affect launch (value withheld)' : 'No Node runtime option contamination',
    'environment presence check; contents never returned',
  ));

  const missingRoots = input.projectRoots.filter((root) => !root.exists);
  checks.push(check(
    'project-roots', 'Project root resolution',
    input.projectRoots.length === 0 ? 'UNKNOWN' : missingRoots.length ? 'FAIL' : input.projectRootsTruncated ? 'WARN' : 'PASS',
    input.projectRoots.length === 0
      ? 'No project root bindings were declared'
      : missingRoots.length
        ? `${missingRoots.length}/${input.projectRoots.length} configured roots are unavailable: ${missingRoots.map((root) => root.projectId).join(', ')}`
        : `${input.projectRoots.length} configured roots resolve to directories${input.projectRootsTruncated ? '; scan capped' : ''}`,
    'external machine profile + Workbench-local verified rebind projection; paths withheld',
  ));

  for (const harness of ['codex', 'claude', 'deepseek']) {
    const observed = input.harnesses.find((item) => item.harness === harness);
    checks.push(check(
      `harness.${harness}`, `${harness} executable and capability`,
      !observed ? 'UNKNOWN' : observed.available ? 'PASS' : 'WARN',
      observed ? `${doctorSafeEvidence(observed.evidence)}; protocol declared by ${harness} adapter` : 'Capability probe did not return a result',
      'bounded adapter capability probe; no dispatch and no configuration write',
    ));
  }

  checks.push(check(
    'state.writable', 'Workbench state directory writable',
    input.state.writable ? 'PASS' : 'FAIL', input.state.writableReason,
    'filesystem access check only; no probe file created',
  ));
  checks.push(check(
    'state.integrity', 'Corrupt local state isolation',
    !input.state.integrityReadable ? 'FAIL' : input.state.isolatedProblems > 0 || input.state.scanTruncated ? 'WARN' : 'PASS',
    !input.state.integrityReadable
      ? 'One or more bounded state readers could not isolate or report their records'
      : `${input.state.isolatedProblems} isolated problem(s); ${input.state.inspectedFrozenScopes} Frozen Packet scope(s) inspected${input.state.scanTruncated ? '; scan capped' : ''}`,
    'Activity/workspace readers + bounded Frozen Packet validation',
  ));
  checks.push(check(
    'profile.portability', 'Profile Bundle and rebind health',
    !input.profile.valid ? 'FAIL' : input.profile.unresolved || input.profile.missingRoots || input.profile.scanTruncated ? 'WARN' : 'PASS',
    !input.profile.valid
      ? 'Local portability binding state was rejected'
      : `${input.profile.bindings} binding(s), ${input.profile.unresolved} unresolved, ${input.profile.missingRoots} bound roots unavailable${input.profile.scanTruncated ? '; scan capped' : ''}`,
    'Workbench-owned portability binding state; external profiles remain read-only',
  ));
  checks.push(check(
    'material.capability', 'Material capability and fallback',
    input.material.fallbackReason ? 'WARN' : 'PASS',
    input.material.fallbackReason
      ? `${input.material.requested} resolved to ${input.material.effective}: ${input.material.fallbackReason}`
      : `${input.material.requested} resolved to ${input.material.effective}`,
    'stored Workbench preference + runtime capability resolution',
  ));
  checks.push(check(
    'app.single-instance', 'Single-instance condition',
    input.singleInstance ? 'PASS' : 'FAIL',
    input.singleInstance ? 'This process owns the Electron single-instance lock' : 'Single-instance ownership is not confirmed',
    'Electron requestSingleInstanceLock result',
  ));

  return { generatedAt: input.now, readOnly: true, bounded: true, checks };
}
