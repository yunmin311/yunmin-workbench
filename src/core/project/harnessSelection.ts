import type { HarnessCapabilities } from '../types';

export type HarnessTarget = HarnessCapabilities['harness'];
export type HarnessCapabilityMatrix = Record<HarnessTarget, HarnessCapabilities>;

const ORDER: HarnessTarget[] = ['codex', 'claude', 'deepseek'];

export function canDispatchToHarness(capability: HarnessCapabilities): boolean {
  return capability.canDispatch && capability.support.dispatch === 'YES';
}

export function dispatchableHarnesses(matrix: HarnessCapabilityMatrix): HarnessTarget[] {
  return ORDER.filter((harness) => canDispatchToHarness(matrix[harness]));
}

/** A sole target needs no choice. Multiple targets require an explicit existing/user selection. */
export function resolveHarnessTarget(
  matrix: HarnessCapabilityMatrix,
  explicit: HarnessTarget | null,
): HarnessTarget | null {
  const available = dispatchableHarnesses(matrix);
  if (explicit) return available.includes(explicit) ? explicit : null;
  return available.length === 1 ? available[0] : null;
}
