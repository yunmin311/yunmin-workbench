// Adapted from stablyai/orca (MIT), src/shared/child-process/windows-command-line.ts.

function quoteWindows(value: string, escapePercent: boolean): string {
  if (!(escapePercent ? /[\\"%]/ : /[\\"]/.test(value))) return `"${value}"`;
  let quoted = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      quoted += `${'\\'.repeat(backslashes * 2)}""`;
      backslashes = 0;
      continue;
    }
    if (escapePercent && char === '%') {
      quoted += `${'\\'.repeat(backslashes * 2)}"^%"`;
      backslashes = 0;
      continue;
    }
    quoted += `${'\\'.repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

export function buildWindowsCmdShimCommandLine(program: string, args: readonly string[]): string {
  for (const value of [program, ...args]) {
    if (/[\r\n]/.test(value)) {
      throw new Error('cmd.exe cannot receive an argument containing a line break');
    }
  }
  const inner = [program, ...args].map((value) => quoteWindows(value, true)).join(' ');
  return `/d /v:off /s /c "${inner}"`;
}

export function isCmdInterpretedProgram(program: string): boolean {
  return /\.(?:cmd|bat)$/i.test(program);
}
