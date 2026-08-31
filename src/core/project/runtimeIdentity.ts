export function runtimeExecutionId(harness: string, externalSessionRef: string): string {
  return `${harness}::${externalSessionRef}`;
}
