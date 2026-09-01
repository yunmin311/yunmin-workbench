/**
 * Capability evidence is an allowlist surface: only version-shaped facts may
 * reach the renderer or the Doctor report. Raw external stdout/stderr, env
 * values, tokens and paths from harness processes are withheld at the source,
 * so every consumer inherits the bound.
 */

/** `name/version` shaped userAgent, e.g. `codex-cli/1.2.3`. */
export function allowlistedUserAgent(value: string): string | undefined {
  return /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}\/v?\d+[A-Za-z0-9._/-]{0,63})/.exec(value.trim())?.[1];
}

/** Leading version token of a first output line, e.g. `2.1.207`. */
export function allowlistedVersionToken(line: string): string | undefined {
  return /^v?(\d+(?:[._-][A-Za-z0-9]+){0,5})/.exec(line.trim())?.[0];
}

/** Reduces a probe failure to an allowlisted fact: exit/error codes only. */
export function boundedProcessError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === 'string' && code) return `process error ${code}`;
  const raw = error instanceof Error ? error.message : String(error);
  if (/^app-server request timed out/.test(raw)) return 'app-server request timed out';
  const rpc = /^app-server (-?\d{1,6}|error):/.exec(raw)?.[1];
  if (rpc) return `app-server error ${rpc}`;
  return 'process error';
}
