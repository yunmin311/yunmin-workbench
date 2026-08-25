import type { ContextItem, OverlaySnapshot } from '../types';

/**
 * Context staging candidates for a task (PDF §5).
 * Memory hooks and INBOX items enter as References (locators, not bodies);
 * governance facts enter as Included context. Manual items are Workbench-owned.
 * sourceRef points at the canonical file so packets can do staleness checks.
 */
export function buildStaging(snapshot: OverlaySnapshot, projectId: string): ContextItem[] {
  const items: ContextItem[] = [];
  const adapter = snapshot.projects.find((p) => p.projectId === projectId);

  if (adapter) {
    const adapterRef = adapter.observed.sourceRef;
    for (const [k, v] of Object.entries(adapter.gates)) {
      items.push({
        id: `gate:${projectId}:${k}`,
        title: `Gate: ${k}`,
        source: `adapter:${projectId}`,
        body: v,
        state: 'included',
        pinned: false,
        isReference: false,
        sourceRef: adapterRef,
      });
    }
    if (adapter.canonicalSource?.path) {
      items.push({
        id: `canon:${projectId}`,
        title: `Canonical source: ${adapter.canonicalSource.path}`,
        source: `adapter:${projectId}`,
        body: `${adapter.canonicalSource.remote ?? ''} @ ${adapter.canonicalSource.commit ?? '?'}`,
        state: 'included',
        pinned: false,
        isReference: true,
        sourceRef: adapterRef,
      });
    }
  }

  for (const m of snapshot.memoryIndex) {
    items.push({
      id: `memory:${m.id}`,
      title: m.title,
      source: `memory:${m.id}`,
      body: m.hook,
      state: 'available',
      pinned: false,
      isReference: true,
      sourceRef: m.sourceRef,
    });
  }

  for (const i of snapshot.inbox.filter(
    (x) => x.attention && x.scope === 'project' && x.projectId === projectId,
  )) {
    items.push({
      id: i.id,
      title: `INBOX #${i.line}`,
      source: `inbox:${i.line}`,
      body: i.raw,
      state: 'available',
      pinned: false,
      isReference: true,
      sourceRef: i.sourceRef.split('#')[0],
    });
  }

  return items;
}
