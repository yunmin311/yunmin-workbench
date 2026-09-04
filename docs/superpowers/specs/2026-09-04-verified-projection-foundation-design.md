# Verified Projection Foundation Design

## Decision

Yunmin Workbench owns its product semantics and Projection IR. Archify is a
donor for generic verification mechanisms, not an intermediate format, source
of truth, renderer, controller, or product shell.

The implementation is a Workbench-native, strict `ProjectionCandidateV0`
compiled from the existing read-only facts. A candidate becomes visible to the
Canvas only after structural and semantic validation and a source-digest
recheck. Failed or stale candidates never replace the last verified revision.

## Frozen baseline and branch

- Workbench baseline: `93d747a18479af90fddac4cf2b9a62e2beef4a40`
- Feature branch: `codex/verified-projection-foundation`
- Archify reviewed commit: `06dd052602dd9a369e4d034e24faef0917b5a60c`
- No merge to `main` in this phase.

## Trust boundary

```text
Governance / Runtime / Git / History facts
  -> compile candidate bound to sourceDigest D0
  -> strict structural validation
  -> Workbench semantic validation
  -> source digest recheck D1
       D1 != D0: STALE, reject candidate, retain last-known-good
       invalid:   NEEDS_FIX, reject candidate, retain last-known-good
       valid:     issue receipt and VerifiedProjectionRevision
  -> Canvas consumes only VerifiedProjectionRevision through a read-only adapter
```

Projection IR is a projection and never a canonical source. No compiler or
adapter writes Governance, Runtime, Git, History, Frozen, or R0 contracts.

## Projection IR v0

All objects are closed: unknown fields are rejected. IDs are stable and
namespaced from existing identities, never array indexes or coordinates.

```ts
interface ProjectionCandidateV0 {
  schemaVersion: 0;
  projectionKind: 'workbench';
  scope: { projectId: string };
  sourceBinding: { sourceDigest: string };
  semanticFacts: {
    conversations: ConversationProjectionV0[];
    runtimeExecutions: RuntimeExecutionProjectionV0[];
    collaborationRelations: CollaborationRelationProjectionV0[];
    artifactsOrEvidence: ArtifactOrEvidenceProjectionV0[];
    evidenceRefs: EvidenceRefV0[];
  };
  layoutState: LayoutStateV0;
}
```

### ConversationProjectionV0

- `id`: `conversation:<Workbench conversation key>`.
- `conversationKey`: Workbench-local render key, explicitly not identity.
- `canonicalConversationId`: present only when Governance supplied it.
- `projectId`, `role`, optional `level`, `platform`.
- `lifecycleState`, `taskState`, `runtimeState`, `attentionState` remain four
  independent fields.
- `verification` and `evidenceRefs` retain the source contract.

### RuntimeExecutionProjectionV0

- `id`: `execution:<existing Workbench execution id>`.
- `executionId`, `nativeRef`, `harness`, `projectId` come from the existing
  runtime projection.
- `conversationRef` is optional and refers to a Conversation projection; the
  execution is never the Conversation identity.
- `binding`, `runtimeState`, `live`, start/end time, intent state, receipt, and
  `evidenceRefs` preserve only observed facts. Missing values remain `null`.

### CollaborationRelationProjectionV0

- `parallel`: requires an explicit `groupId` and at least two distinct existing
  execution refs.
- `handoff`: requires existing source/target execution refs and an exact
  `usedResultRef` pointing to an artifact produced by the source execution.
- No order, coordinate, cwd, provider, text similarity, or timestamp heuristic
  may create a relation.

### ArtifactOrEvidenceProjectionV0

The v0 kinds that v0 actually emits are: `agent-result`, `tool-evidence`,
`file-evidence`, `runtime-receipt`, `governance-record`, `git-fact`, and
`memory-index`. Each item has a stable ID, project scope, optional exact
execution/event refs, bounded title/content, and evidence refs.

`history-fact` remains a reserved enum kind only. v0 does not emit it: History
has no canonical Project binding, and v0 forbids inferring one from cwd,
provider, or time proximity. History can return to Projection only when an
explicit trusted Project binding exists.

### EvidenceRefV0

`source`, `sourceRef`, `observedAt`, `verification`, `currentness`, and optional
revision are retained. `currentness` is one of `CURRENT`, `STALE`, `INVALID`, or
`UNKNOWN`. A compiler cannot turn missing currentness into CURRENT. Revision
kinds are limited to `sha256`, `git-commit`, `activity-event`, and
`history-session` (reserved).

### LayoutStateV0

`nodePositions` maps a semantic ID to finite `{x, y}` coordinates and may carry
a finite viewport. It cannot contain edge, parent, group, source, target, or
lineage fields. A layout-only change changes `layoutHash` and `revisionHash`,
but not `semanticHash`.

### ProjectionDiagnosticV0

Every diagnostic has exactly:

```ts
{
  code: string;
  severity: 'error' | 'warning';
  message: string;
  subject: Record<string, unknown>;
  evidence: Record<string, unknown>;
  supportedFixes: string[];
}
```

### Revision and receipt

`VerifiedProjectionRevisionV0` carries the validated candidate plus
`sourceDigest`, `semanticHash`, `layoutHash`, `revisionHash`, `revisionId`,
`verifiedAt`, and optional `previousRevisionId`. `verifiedAt` is not part of a
hash. Semantic arrays are sorted by stable ID before hashing.

`ProjectionReceiptV0` records outcome (`VERIFIED`, `NEEDS_FIX`, or `STALE`),
candidate/source/rechecked digests, new revision ID, retained revision ID,
check time, and structured diagnostics. Invalid candidate bodies are not kept
as current state.

## Existing fact mapping

| Workbench input | Projection output | Guardrail |
|---|---|---|
| `OverlaySnapshot.conversations` | Conversation | local key never impersonates canonical identity |
| `projectRuntimeExecutions(activity, liveIds)` | RuntimeExecution | no cwd/provider/time identity guessing |
| explicit Activity `groupId` with 2+ executions | parallel relation | one execution is not parallel |
| `projectTrajectory(activity)` exact source ref | handoff relation | no event-order or geometry inference |
| agent response with content | agent-result artifact | summary-only output is not a result |
| tool/file event with `evidenceRef` | evidence artifact | missing ref produces no artifact |
| runtime receipt | receipt artifact and execution receipt | receipt never proves task completion |
| Observation / SourceFingerprint | EvidenceRef | provenance and currentness remain visible |
| ProjectAdapter / GitFacts | corresponding evidence artifact | only when scoped to the projection project |
| Canvas positions | LayoutState only | positions never create or alter lineage |

## sourceDigest dependency scope

`sourceDigest` for a Project A candidate is the hash of the dependency set the
candidate actually consumed, not of every fingerprint the snapshot happened to
read. Unrelated Project B canonical files must not change Project A's digest.

Allowed dependencies:

- Project A Conversations and their observations;
- Project A ProjectAdapter observation;
- Project A Activity;
- Project A GitFacts when present;
- sourceFingerprints restricted to the exact `sourceRef` set the compiled
  candidate referenced (conversations, ProjectAdapter, Memory, git-commit,
  activity protocol refs);
- global Memory Vault dependencies, because the present product mounts the
  shared/global Memory Vault into every Project Canvas.

If a fingerprint cannot be proven to belong to a consumed dependency, the
compiler omits it; UNKNOWN is preferred to guessing. Path-name heuristics are
never used to guess Project ownership.

## Deferred explicitly

Route/Reach UI, Projection Delta UI, Semantic Passport, guided views, complex
repository evidence, revision browser/persistence expansion, export/share-card,
and Canvas redesign are outside this phase.

## Archify reuse map

| Asset | Decision |
|---|---|
| strict schemas and stable IDs | ADAPT to Workbench Zod strict schemas |
| `validator.mjs` error-path annotation | ADAPT to Workbench subjects/evidence |
| pure normalization/dedup from `diagnostics.mjs` | ADAPT / PORT WITH ATTRIBUTION |
| process-global recorder, fs/process boundary | REJECT |
| repository-evidence fail-closed principles | ADAPT; repository implementation deferred |
| preview candidate/digest/last-good/commit recheck | ADAPT into pure functions and existing Zustand store |
| preview server, watcher, child renderer | REJECT |
| architecture-delta semantic hashing concepts | ADAPT only where needed for v0 hashes; UI deferred |
| route/reach/passport/guided view contracts | ADAPT later; no v0 UI |
| SVG/layout compiler, HTML/export/share-card, WYSIWYG semantics | REJECT |

The TypeScript diagnostics port will name the upstream file and commit. The
Workbench `THIRD_PARTY_NOTICES.md` will include Archify's MIT license and both
copyright lines. No process-global recorder, brand asset, or third-party mark
data is copied.

## Minimal integration

The compiler and revision state machine live under `src/core/projection` and
remain pure. The existing Zustand store owns the current build status and
last-known-good revision; no second controller or persistence authority is
introduced. `CanvasView` receives only a verified revision and converts it to
the existing `WbNode`/`WbEdge` display model through a read-only adapter.

With no last-known-good revision, Canvas renders the projection status and
diagnostics instead of rebuilding from raw Snapshot/Activity data.

## Deferred explicitly

Route/Reach UI, Projection Delta UI, Semantic Passport, guided views, complex
repository evidence, revision browser/persistence expansion, export/share-card,
and Canvas redesign are outside this phase.
