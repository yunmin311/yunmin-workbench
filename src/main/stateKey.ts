/** Stable, filesystem-safe encoding for every Workbench-owned state key. */
export function encodeStateKey(value: string): string {
  return `k-${Buffer.from(value, 'utf8').toString('base64url')}`;
}
