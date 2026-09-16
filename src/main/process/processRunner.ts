// Contract and Windows behavior adapted from stablyai/orca (MIT),
// src/shared/child-process/{process-spec,run-process,spawn-resolution,process-tree-termination}.ts.
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { statSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { buildWindowsCmdShimCommandLine, isCmdInterpretedProgram } from './windowsCommandLine';
import { resolveWindowsCmdShim } from './windowsCmdShim';

export interface ProcessSpec {
  program: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  keepStdinOpen?: boolean;
  timeoutMs?: number | null;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  ownProcessTree?: boolean;
  terminationGraceMs?: number;
}

export interface ProcessTerminationResult {
  attempted: boolean;
  confirmed: boolean;
  method: 'natural' | 'taskkill-tree' | 'process-group' | 'root-handle';
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
  termination: ProcessTerminationResult;
}

export interface ResolvedProcessSpawn {
  file: string;
  args: readonly string[];
  options: SpawnOptions;
}

export interface OwnedProcess {
  child: ChildProcessWithoutNullStreams;
  result: Promise<ProcessResult>;
  terminate(): Promise<ProcessTerminationResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

export function resolveProgramOnPath(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32' || isAbsolute(program) || /[\\/]/.test(program)) return program;
  const pathEntries = (envValue(env, 'PATH') ?? '').split(platform === 'win32' ? ';' : delimiter);
  const hasExtension = /\.[^\\/.]+$/.test(program);
  const extensions = hasExtension
    ? ['']
    : (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').map((value) => value.trim()).filter(Boolean);
  for (const rawDirectory of pathEntries) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, '$1');
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, `${program}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return program;
}

export function resolveProcessSpawn(spec: ProcessSpec, platform: NodeJS.Platform = process.platform): ResolvedProcessSpawn {
  const args = spec.args ?? [];
  const program = resolveProgramOnPath(spec.program, spec.env ?? process.env, platform);
  const base: SpawnOptions = {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    detached: Boolean(spec.ownProcessTree && platform !== 'win32'),
  };
  if (platform !== 'win32' || !isCmdInterpretedProgram(program)) {
    return { file: program, args, options: base };
  }
  const shim = resolveWindowsCmdShim(program, spec.env ?? process.env);
  if (shim) {
    return {
      file: shim.program,
      args: [...shim.prefixArgs, ...args],
      options: { ...base, ...(shim.env ? { env: shim.env } : {}) },
    };
  }
  const comSpec = spec.env?.ComSpec ?? process.env.ComSpec ?? 'cmd.exe';
  return {
    file: comSpec,
    args: [buildWindowsCmdShimCommandLine(program, args)],
    options: { ...base, windowsVerbatimArguments: true },
  };
}

function outputSink(maxBytes: number) {
  const chunks: Buffer[] = [];
  let seen = 0;
  return {
    write(raw: Buffer | string) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const remaining = maxBytes - Math.min(seen, maxBytes);
      if (remaining > 0) chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      seen += chunk.length;
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    truncated: () => seen > maxBytes,
  };
}

function waitForClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(confirmed);
    };
    const onClose = () => finish(true);
    child.once('close', onClose);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
  });
}

async function terminateTree(child: ChildProcessWithoutNullStreams, spec: ProcessSpec): Promise<ProcessTerminationResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { attempted: false, confirmed: true, method: 'natural' };
  }
  const grace = spec.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  let method: ProcessTerminationResult['method'] = 'root-handle';
  try {
    if (process.platform === 'win32' && child.pid) {
      method = 'taskkill-tree';
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore', windowsHide: true, shell: false,
      });
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        killer.once('error', finish);
        killer.once('close', finish);
        const timer = setTimeout(() => { try { killer.kill(); } catch {} finish(); }, Math.min(grace, 2_000));
        timer.unref?.();
      });
    } else if (spec.ownProcessTree && child.pid) {
      method = 'process-group';
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
  if (await waitForClose(child, grace)) return { attempted: true, confirmed: true, method };
  try {
    if (method === 'process-group' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {}
  return { attempted: true, confirmed: await waitForClose(child, grace), method };
}

export function spawnOwnedProcess(spec: ProcessSpec): OwnedProcess {
  const resolved = resolveProcessSpawn(spec);
  const child = spawn(resolved.file, [...resolved.args], resolved.options) as ChildProcessWithoutNullStreams;
  const stdout = outputSink(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  const stderr = outputSink(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  child.stdout.on('data', (chunk: Buffer | string) => stdout.write(chunk));
  child.stderr.on('data', (chunk: Buffer | string) => stderr.write(chunk));
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => undefined);

  let externalTermination: Promise<ProcessTerminationResult> | undefined;
  let requestExternalStop: (() => void) | undefined;
  const externalStop = new Promise<void>((resolve) => { requestExternalStop = resolve; });
  const terminate = (): Promise<ProcessTerminationResult> => {
    externalTermination ??= terminateTree(child, spec);
    requestExternalStop?.();
    return externalTermination;
  };

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    let settled = false;
    const finish = (value: { code: number | null; signal: NodeJS.Signals | null }) => {
      if (!settled) { settled = true; resolve(value); }
    };
    child.once('error', (error) => {
      stderr.write(error instanceof Error ? error.message : String(error));
      finish({ code: 127, signal: null });
    });
    child.once('close', (code, signal) => finish({ code, signal }));
  });

  const result = (async (): Promise<ProcessResult> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: () => void = () => undefined;
    const timeoutSignal = spec.timeoutMs === null ? new Promise<'timeout'>(() => undefined) : new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      timeout.unref?.();
    });
    const abortSignal = new Promise<'abort'>((resolve) => {
      const abort = () => resolve('abort');
      if (spec.signal?.aborted) abort();
      else spec.signal?.addEventListener('abort', abort, { once: true });
      removeAbort = () => spec.signal?.removeEventListener('abort', abort);
    });
    try {
      if (spec.keepStdinOpen) {
        if (spec.input !== undefined) child.stdin.write(spec.input);
      } else {
        child.stdin.end(spec.input);
      }
      const winner = await Promise.race([
        exit.then((value) => ({ kind: 'exit' as const, value })),
        timeoutSignal.then(() => ({ kind: 'timeout' as const })),
        abortSignal.then(() => ({ kind: 'abort' as const })),
        externalStop.then(() => ({ kind: 'external' as const })),
      ]);
      let termination: ProcessTerminationResult;
      let exitValue: { code: number | null; signal: NodeJS.Signals | null };
      if (winner.kind === 'exit') {
        exitValue = winner.value;
        termination = { attempted: false, confirmed: true, method: 'natural' };
      } else {
        termination = await terminate();
        exitValue = await exit.catch(() => ({ code: null, signal: null }));
      }
      return {
        ...exitValue,
        stdout: stdout.text(), stderr: stderr.text(),
        timedOut: winner.kind === 'timeout', aborted: winner.kind === 'abort',
        outputTruncated: stdout.truncated() || stderr.truncated(), termination,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      removeAbort();
    }
  })();

  return { child, result, terminate };
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  return spawnOwnedProcess(spec).result;
}
