import type { ContextIncludeState, ContextItem, SourceFingerprint } from '../types';
import { projectFileSourceRef } from './sourceIdentity';

export const DRAFT_SCHEMA_VERSION = 1 as const;

export interface DraftScopeV1 {
  /** Migration-era local scope. It is not canonical conversation identity. */
  kind: 'migration-conversation-key';
  projectId: string;
  conversationKey: string;
  /** Reserved seam only; no key-to-id inference is performed. */
  canonicalConversationId?: string;
}

interface DraftDecisionV1 {
  state: ContextIncludeState;
  pinned: boolean;
  order: number;
}

export interface ManualDraftItemV1 extends DraftDecisionV1 {
  id: string;
  title: string;
  body: string;
  provenance: 'USER PROVIDED';
}

export interface ProjectFileDraftItemV1 extends DraftDecisionV1 {
  projectId: string;
  relativePath: string;
  asReference: boolean;
  /** Last observation for change disclosure, never treated as current truth. */
  lastKnownSha256?: string;
}

export interface ProjectedDraftDecisionV1 extends DraftDecisionV1 {
  itemId: string;
}

export interface WorkbenchDraftV1 {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  scope: DraftScopeV1;
  taskSummary: string;
  manualContexts: ManualDraftItemV1[];
  projectFiles: ProjectFileDraftItemV1[];
  projectedDecisions: ProjectedDraftDecisionV1[];
}

export function buildWorkbenchDraft(
  projectId: string,
  conversationKey: string,
  canonicalConversationId: string | undefined,
  taskSummary: string,
  staging: ContextItem[],
  fingerprints: SourceFingerprint[],
): WorkbenchDraftV1 {
  const byRef = new Map(fingerprints.map((item) => [item.sourceRef, item.sha256]));
  const draft: WorkbenchDraftV1 = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    scope: {
      kind: 'migration-conversation-key',
      projectId,
      conversationKey,
      canonicalConversationId,
    },
    taskSummary,
    manualContexts: [],
    projectFiles: [],
    projectedDecisions: [],
  };

  staging.forEach((item, order) => {
    const decision = { state: item.state, pinned: item.pinned, order };
    if (item.provenance === 'USER PROVIDED') {
      draft.manualContexts.push({
        ...decision,
        id: item.id,
        title: item.title,
        body: item.body,
        provenance: 'USER PROVIDED',
      });
    } else if (item.source === `project-file:${projectId}` && item.relativePath) {
      draft.projectFiles.push({
        ...decision,
        projectId,
        relativePath: item.relativePath,
        asReference: item.isReference,
        lastKnownSha256: item.sourceRef ? byRef.get(item.sourceRef) : undefined,
      });
    } else {
      draft.projectedDecisions.push({ ...decision, itemId: item.id });
    }
  });
  return draft;
}

function explicitKey(relativePath: string, asReference: boolean): string {
  return `${relativePath}\0${asReference ? 'reference' : 'context'}`;
}

export interface RestoredDraft {
  staging: ContextItem[];
  orphanedDecisionIds: string[];
  unavailableProjectFiles: string[];
}

/** Reapply local decisions to fresh truth. No external body is restored from disk state. */
export function restoreWorkbenchDraft(
  freshProjected: ContextItem[],
  draft: WorkbenchDraftV1,
  resolvedProjectFiles: ContextItem[],
): RestoredDraft {
  const decisions = new Map(draft.projectedDecisions.map((item) => [item.itemId, item]));
  const restored: { item: ContextItem; order: number }[] = [];
  const presentProjected = new Set(freshProjected.map((item) => item.id));

  freshProjected.forEach((item, freshOrder) => {
    const decision = decisions.get(item.id);
    restored.push({
      item: decision
        ? {
            ...item,
            state: decision.state,
            pinned: decision.state === 'included' ? decision.pinned : false,
          }
        : item,
      order: decision?.order ?? Number.MAX_SAFE_INTEGER - freshProjected.length + freshOrder,
    });
  });

  for (const manual of draft.manualContexts) {
    restored.push({
      order: manual.order,
      item: {
        id: manual.id,
        title: manual.title,
        source: 'manual',
        body: manual.body,
        state: manual.state,
        pinned: manual.state === 'included' ? manual.pinned : false,
        isReference: false,
        provenance: 'USER PROVIDED',
      },
    });
  }

  const resolved = new Map(
    resolvedProjectFiles
      .filter((item) => item.relativePath)
      .map((item) => [explicitKey(item.relativePath!, item.isReference), item]),
  );
  const unavailableProjectFiles: string[] = [];
  for (const file of draft.projectFiles) {
    const current = resolved.get(explicitKey(file.relativePath, file.asReference));
    if (!current) unavailableProjectFiles.push(file.relativePath);
    restored.push({
      order: file.order,
      item: current
        ? {
            ...current,
            state: file.state,
            pinned: file.state === 'included' ? file.pinned : false,
          }
        : {
            id: `project-file:${file.projectId}:${file.relativePath}:${file.asReference ? 'reference' : 'context'}`,
            title: file.relativePath,
            source: `project-file:${file.projectId}`,
            body: '(source unavailable; no cached external content restored)',
            state: file.state,
            pinned: file.state === 'included' ? file.pinned : false,
            isReference: file.asReference,
            sourceRef: projectFileSourceRef(file.projectId, file.relativePath),
            provenance: 'EXTERNAL',
            relativePath: file.relativePath,
          },
    });
  }

  return {
    staging: restored.sort((a, b) => a.order - b.order).map(({ item }) => item),
    orphanedDecisionIds: draft.projectedDecisions
      .filter((item) => !presentProjected.has(item.itemId))
      .map((item) => item.itemId),
    unavailableProjectFiles,
  };
}
