// Demo environment adapter — deterministic interception of the production
// `window.wb` IPC surface while the renderer is in DEMO mode.
//
// This module only runs in the renderer (no preload, no main). It:
//   - Watches the Zustand store for `demoMode` transitions
//   - Patches `window.wb.searchHistory / listHistory / readHistoryDetail`
//     so the History panel renders against demo fixtures, not IPC
//   - Patches `window.wb.searchMemory / expandMemory` for the same reason
//   - Patches `window.wb.readFrozenDetail` so the Packet panel can show bodies
//   - Leaves all other wb.* calls intact (real Overlay, runtime, etc.)
//
// Demo data is explicitly labelled and never written back to SOT. When demo
// mode exits, the patches are removed and the original IPC takes over again.

import { useWorkbench } from '../store';
import {
  DEMO_HISTORY_CATALOG,
  DEMO_HISTORY_DETAILS,
  getDemoHistorySearchResult,
  getDemoMemoryDetail,
  getDemoMemorySearchResult,
  getDemoFrozenDetail,
} from '../demo/demoData';

type AnyFn = (...args: unknown[]) => unknown;

interface PatchRecord {
  method: string;
  original: AnyFn;
}

const patches: PatchRecord[] = [];
let installed = false;

function installPatches() {
  if (installed) return;
  installed = true;
  const wb = (window as unknown as { wb?: Record<string, AnyFn> }).wb;
  if (!wb) return;

  // History
  patch(wb, 'listHistory', async () => DEMO_HISTORY_CATALOG);
  patch(wb, 'searchHistory', async (query: unknown) => {
    const text = (query as { text?: string })?.text ?? '';
    return getDemoHistorySearchResult(text);
  });
  patch(wb, 'readHistoryDetail', async (sessionId: unknown) => {
    const id = String(sessionId);
    return DEMO_HISTORY_DETAILS[id] ?? null;
  });

  // Memory
  patch(wb, 'searchMemory', async (query: unknown) => {
    const text = (query as { text?: string })?.text ?? '';
    return getDemoMemorySearchResult(text);
  });
  patch(wb, 'expandMemory', async (id: unknown) => {
    return getDemoMemoryDetail(String(id));
  });

  // Frozen packet detail
  patch(wb, 'readFrozenDetail', async (_projectId: unknown, _conversationKey: unknown, query: unknown) => {
    const state = useWorkbench.getState();
    const hash = (query as { hash?: string } | undefined)?.hash;
    const version = (query as { version?: number } | undefined)?.version;
    const summary = state.frozen.find((item) =>
      (hash && item.hash === hash) || (typeof version === 'number' && item.version === version),
    );
    if (!summary) return null;
    return getDemoFrozenDetail(summary);
  });
}

function patch(wb: Record<string, AnyFn>, method: string, replacement: AnyFn) {
  const original = wb[method];
  if (typeof original !== 'function') return;
  patches.push({ method, original });
  wb[method] = replacement;
}

function uninstallPatches() {
  if (!installed) return;
  installed = false;
  const wb = (window as unknown as { wb?: Record<string, AnyFn> }).wb;
  if (!wb) return;
  for (const patch of patches) {
    wb[patch.method] = patch.original;
  }
  patches.length = 0;
}

let previousDemoMode: boolean | null = null;

export function startDemoEnvironmentWatcher() {
  setInterval(() => {
    const isDemo = useWorkbench.getState().demoMode;
    if (isDemo && previousDemoMode !== true) installPatches();
    if (!isDemo && previousDemoMode === true) uninstallPatches();
    previousDemoMode = isDemo;
  }, 200);
}
