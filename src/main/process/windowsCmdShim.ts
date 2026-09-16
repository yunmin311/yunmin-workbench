// Adapted from stablyai/orca (MIT), src/shared/child-process/windows-cmd-shim-resolution.ts.
import { readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

const MAX_SHIM_BYTES = 64 * 1024;
const UNSAFE_SHIM_PATH = /[%^&|<>":\r\n]/;
const DIRECT_TARGET_EXTENSIONS = ['.exe', '.com'];

type ParsedShim =
  | { kind: 'node'; script: string; nodePathPrefix?: string }
  | { kind: 'direct'; target: string };

function canonicalize(contents: string): string {
  return contents.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim())
    .filter(Boolean).join('\n');
}

function safeRelative(value: string): boolean {
  return !UNSAFE_SHIM_PATH.test(value) && !win32.isAbsolute(value);
}

/** Recognises the generated npm/pnpm shim shapes Workbench may bypass safely. */
export function parseWindowsCmdShim(contents: string): ParsedShim | null {
  const body = canonicalize(contents);
  const current = body.match(/endLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%" +"(?:%~dp0|%dp0%)\\?(?<script>[^"\r\n]+)" +%\*$/i)?.groups;
  if (current?.script) return safeRelative(current.script) ? { kind: 'node', script: current.script } : null;

  const branched = body.match(/IF EXIST "(?:%~dp0|%dp0%)\\?node\.exe" \(\n"(?:%~dp0|%dp0%)\\?node\.exe" +"(?:%~dp0|%dp0%)\\?(?<script>[^"\r\n]+)" +%\*\n\) ELSE \(\n(?:SETLOCAL\n)?SET PATHEXT=%PATHEXT:;\.JS;=;%\nnode +"(?:%~dp0|%dp0%)\\?(?<fallback>[^"\r\n]+)" +%\*\n\)$/i)?.groups;
  if (branched?.script && branched.script === branched.fallback && safeRelative(branched.script)) {
    return { kind: 'node', script: branched.script };
  }

  const direct = body.match(/(?:@echo off\n)?(?:@SETLOCAL\n)?@?"(?:%~dp0|%dp0%)\\?(?<target>[^"\r\n]+)" +%\*$/i)?.groups?.target;
  return direct && safeRelative(direct) ? { kind: 'direct', target: direct } : null;
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function resolveNode(directory: string, env: NodeJS.ProcessEnv): string | null {
  const sibling = win32.join(directory, 'node.exe');
  if (isFile(sibling)) return sibling;
  const extensions = (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';').map((value) => value.trim().toLowerCase()).filter((value) => value.startsWith('.'));
  for (const raw of (envValue(env, 'PATH') ?? '').split(';')) {
    const directoryPath = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!directoryPath || !win32.isAbsolute(directoryPath)) continue;
    for (const extension of extensions) {
      const candidate = win32.join(directoryPath, `node${extension}`);
      if (!isFile(candidate)) continue;
      return extension === '.exe' ? candidate : null;
    }
  }
  return null;
}

export interface WindowsCmdShimResolution {
  program: string;
  prefixArgs: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export function resolveWindowsCmdShim(program: string, env: NodeJS.ProcessEnv): WindowsCmdShimResolution | null {
  if (!win32.isAbsolute(program)) return null;
  let stats;
  try { stats = statSync(program); } catch { return null; }
  if (!stats.isFile() || stats.size > MAX_SHIM_BYTES) return null;
  let parsed: ParsedShim | null;
  try { parsed = parseWindowsCmdShim(readFileSync(program, 'utf8')); } catch { return null; }
  if (!parsed) return null;
  const directory = win32.dirname(program);
  if (parsed.kind === 'direct') {
    const target = win32.resolve(directory, parsed.target);
    if (!DIRECT_TARGET_EXTENSIONS.some((extension) => target.toLowerCase().endsWith(extension))) return null;
    return isFile(target) ? { program: target, prefixArgs: [] } : null;
  }
  const script = win32.resolve(directory, parsed.script);
  const node = resolveNode(directory, env);
  return isFile(script) && node ? { program: node, prefixArgs: [script] } : null;
}
