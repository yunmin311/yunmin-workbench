import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  resolveProcessSpawn,
  runProcess,
  spawnOwnedProcess,
} from '../../src/main/process/processRunner';
import { parseWindowsCmdShim } from '../../src/main/process/windowsCmdShim';

describe('Workbench child-process substrate', () => {
  it('resolves a generated Windows cmd shim without shell:true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wb-process-shim-'));
    const shim = join(root, 'opencode.cmd');
    const script = join(root, 'node_modules', 'opencode', 'bin', 'opencode.js');
    const node = join(root, 'node.exe');
    await mkdir(join(root, 'node_modules', 'opencode', 'bin'), { recursive: true });
    await writeFile(node, 'fixture');
    await writeFile(script, 'fixture');
    const shimContents = [
      '@echo off',
      'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
      'IF EXIST "%~dp0\\node.exe" (', 'SET "_prog=%~dp0\\node.exe"', ') ELSE (', 'SET "_prog=node"',
      'SET PATHEXT=%PATHEXT:;.JS;=;%', ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\node_modules\\opencode\\bin\\opencode.js" %*',
    ].join('\r\n');
    await writeFile(shim, shimContents);

    expect(parseWindowsCmdShim(shimContents)).toEqual({
      kind: 'node', script: 'node_modules\\opencode\\bin\\opencode.js',
    });
    // Full filesystem resolution must use the host's real Windows path
    // semantics. The parser assertion above remains portable on Linux CI.
    if (process.platform !== 'win32') return;

    const resolved = resolveProcessSpawn({ program: shim, args: ['run', 'line one\nline two'] }, 'win32');
    expect(resolved.file.toLowerCase()).toBe(node.toLowerCase());
    expect(resolved.args).toEqual([script, 'run', 'line one\nline two']);
    expect(resolved.options).toMatchObject({ shell: false, windowsHide: true });
  });

  it('captures bounded output and reports a deterministic nonzero result', async () => {
    const result = await runProcess({
      program: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(100)); process.stderr.write('failure'); process.exit(7)"],
      maxOutputBytes: 32,
    });
    expect(result).toMatchObject({ code: 7, timedOut: false, aborted: false, outputTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBe(32);
    expect(result.stderr).toBe('failure');
  });

  it('times out and confirms the owned process has exited', async () => {
    const result = await runProcess({
      program: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 80,
      terminationGraceMs: 2_000,
    });
    expect(result.timedOut).toBe(true);
    expect(result.termination.confirmed).toBe(true);
  });

  it('aborts an owned process through one idempotent termination path', async () => {
    const controller = new AbortController();
    const owned = spawnOwnedProcess({
      program: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal,
    });
    controller.abort();
    const result = await owned.result;
    expect(result.aborted).toBe(true);
    expect(result.termination.confirmed).toBe(true);
    await expect(owned.terminate()).resolves.toMatchObject({ confirmed: true });
  });
});
