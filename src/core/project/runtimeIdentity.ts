export function runtimeExecutionId(harness: string, externalSessionRef: string): string {
  return `${harness}::${externalSessionRef}`;
}

/** Workbench execution identity. Native session refs remain a separate field and may be reused. */
export function workbenchExecutionId(harness: string, intentId: string): string {
  return `${harness}::execution:${intentId}`;
}

export function isValidNativeRuntimeRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !/[\u0000\r\n]/.test(value);
}

export function parseRuntimeExecutionId(value: unknown): { harness: string; externalSessionRef: string } | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('::');
  if (separator <= 0) return null;
  const harness = value.slice(0, separator);
  const externalSessionRef = value.slice(separator + 2);
  if (!/^[a-z][a-z0-9-]*$/.test(harness) || !isValidNativeRuntimeRef(externalSessionRef)) return null;
  return { harness, externalSessionRef };
}
