# Verified Projection Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile existing Workbench facts into a strictly validated, revisioned Projection IR whose last verified revision is the Canvas's only data source.

**Architecture:** Pure modules under `src/core/projection` define the closed IR, compiler, validators, deterministic hashes, receipt state machine, and Canvas adapter. The existing Zustand store holds build status and last-known-good; Canvas never compiles raw facts or falls back to them.

**Tech Stack:** TypeScript 5.7, Zod 3.24, `@noble/hashes`, Vitest, Zustand, React Flow.

**Spec:** `docs/superpowers/specs/2026-09-04-verified-projection-foundation-design.md`

## Global Constraints

- Branch from exact baseline `93d747a18479af90fddac4cf2b9a62e2beef4a40` on `codex/verified-projection-foundation`.
- Governance / Runtime / Frozen / R0 contracts are read-only and unchanged.
- `semanticFacts` and `layoutState` are structurally separate.
- Unknown fields are rejected; missing facts remain UNKNOWN or null.
- Invalid or stale candidates never replace a verified revision.
- Canvas consumes only `VerifiedProjectionRevisionV0` through the adapter.
- Do not implement Route/Reach, Delta UI, Passport, guided views, repository verification, export, share-card, or Canvas redesign.

---

### Task 1: Freeze Projection IR v0 and strict schema

**Files:**
- Create: `src/core/projection/types.ts`
- Create: `src/core/projection/schema.ts`
- Test: `tests/projection/schema.test.ts`

**Interfaces:**
- Produces: all `*V0` interfaces, `projectionCandidateV0Schema`, and `validateProjectionCandidate(input: unknown)`.
- Consumes: existing state unions and `RuntimeBinding` from `src/core/types.ts`.

- [ ] **Step 1: Write strict-schema failing tests**

Create a literal minimal candidate and assert that it parses, an unknown root
field returns `schema/unrecognized_keys`, a non-finite position fails, and the
four Conversation state fields survive unchanged.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `corepack pnpm vitest run tests/projection/schema.test.ts`

Expected: FAIL because `src/core/projection/schema.ts` does not exist.

- [ ] **Step 3: Define the final v0 interfaces before implementation logic**

Implement closed interfaces for candidate, five semantic collections,
diagnostics, receipt, verified revision, and build state exactly as specified
in the design. Do not add optional future product fields.

- [ ] **Step 4: Implement strict Zod schemas and structural diagnostic output**

Every `z.object` uses `.strict()`. Convert each Zod issue to a diagnostic with
code `schema/<issue.code>`, subject path, issue evidence, and a concrete
supported fix.

- [ ] **Step 5: Run schema test and full typecheck**

Run: `corepack pnpm vitest run tests/projection/schema.test.ts`

Run: `corepack pnpm typecheck`

Expected: both exit 0.

### Task 2: Port attributed diagnostics normalization

**Files:**
- Create: `src/core/projection/diagnostics.ts`
- Modify: `tests/projection/schema.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `normalizeProjectionDiagnostic(input)` and `normalizeProjectionDiagnostics(inputs)`.
- Consumes: `ProjectionDiagnosticV0`.

- [ ] **Step 1: Add a failing normalization test**

Assert whitespace-trimmed fallback strings, plain-object filtering, stable
deduplication of `supportedFixes`, and whole-diagnostic deduplication without
any process/global side effect.

- [ ] **Step 2: Run test and verify RED**

Run: `corepack pnpm vitest run tests/projection/schema.test.ts`

Expected: FAIL because normalization functions do not exist.

- [ ] **Step 3: Port the pure functions with provenance**

Adapt only `plainObject` and `normalizedDiagnostic` behavior from Archify
`archify/renderers/shared/diagnostics.mjs` at commit
`06dd052602dd9a369e4d034e24faef0917b5a60c`. Do not copy recorder arrays,
environment mode, process handlers, fs writes, global symbol, or error boundary.

- [ ] **Step 4: Add Archify MIT notice**

Record repository, commit, adapted file/functions, excluded global machinery,
both copyright lines, and full MIT text in `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 5: Run tests**

Run: `corepack pnpm vitest run tests/projection/schema.test.ts`

Expected: exit 0.

### Task 3: Compile real Workbench facts and validate relations

**Files:**
- Create: `src/core/projection/compiler.ts`
- Create: `tests/projection/compiler.test.ts`

**Interfaces:**
- Produces: `ProjectionFactInputV0`, `computeProjectionSourceDigest(input)`, and `compileProjectionCandidate(input)`.
- Consumes: `OverlaySnapshot`, `ActivityEvent`, optional `GitFacts`, `HistorySession`, `LayoutStateV0`, existing `projectRuntimeExecutions`, `projectCompareGroups`, `projectTrajectory`, and `resultSourceRef`.

- [ ] **Step 1: Write failing compiler tests**

Use complete literal Snapshot and Activity fixtures. Assert stable Conversation
and Runtime refs, identity separation, exact evidence fields, no relation when
group/source/result facts are absent, parallel only for two explicit execution
members, and handoff only when `usedResultRef` points to the source result.

- [ ] **Step 2: Run compiler test and verify RED**

Run: `corepack pnpm vitest run tests/projection/compiler.test.ts`

Expected: FAIL because compiler module does not exist.

- [ ] **Step 3: Implement deterministic mapping**

Filter all inputs to `projectId`, derive runtime identity only through the
existing runtime projection, construct artifacts only from exact content/ref
facts, deduplicate evidence by stable ID, sort every semantic array by ID, and
calculate source digest from facts only (never layout).

- [ ] **Step 4: Add semantic validation cases**

Extend tests to feed duplicate IDs, missing evidence refs, missing execution
refs, a one-member parallel relation, wrong handoff source ownership, unknown
layout node IDs, and duplicate relations. Each must yield a structured
`semantic/*` diagnostic.

- [ ] **Step 5: Implement semantic validation**

Add `validateProjectionSemantics(candidate)` to `schema.ts`. It returns all
diagnostics without mutation and never repairs or invents facts.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `corepack pnpm vitest run tests/projection/schema.test.ts tests/projection/compiler.test.ts`

Run: `corepack pnpm typecheck`

Expected: both exit 0.

### Task 4: Revision, receipt, stale rejection, and last-known-good

**Files:**
- Create: `src/core/projection/revision.ts`
- Create: `tests/projection/revision.test.ts`

**Interfaces:**
- Produces: `emptyProjectionBuildState()`, `verifyProjectionCandidate(candidate, previous, options)`, and `buildVerifiedProjection(input, previous, options)`.
- Consumes: candidate compiler, structural/semantic validators, deterministic Workbench hash utilities.

- [ ] **Step 1: Write failing state-machine tests**

Assert valid promotion, invalid candidate retaining last-good, changed recheck
digest yielding STALE, no last-good yielding null current, same revision hash
retaining revision identity, layout-only change preserving semantic hash, and
structured receipts for all outcomes.

- [ ] **Step 2: Run revision test and verify RED**

Run: `corepack pnpm vitest run tests/projection/revision.test.ts`

Expected: FAIL because revision module does not exist.

- [ ] **Step 3: Implement deterministic hashes and promotion**

Hash sorted semantic facts, layout independently, and the verified candidate as
separate SHA-256 values. Recheck `sourceDigest` after validation. Retain a prior
revision only when its project scope matches. Never store an invalid candidate
as current.

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm vitest run tests/projection/revision.test.ts`

Expected: exit 0.

### Task 5: Canvas read-only adapter and store integration

**Files:**
- Create: `src/core/projection/canvasProjection.ts`
- Create: `tests/projection/canvasProjection.test.ts`
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/views/CanvasView.tsx`

**Interfaces:**
- Produces: `projectionToCanvasGraph(revision: VerifiedProjectionRevisionV0)`.
- Store produces: `projection: ProjectionBuildStateV0` and `refreshProjection()` using current Snapshot, Activity, Git, live execution IDs, and layout.
- Canvas consumes: `state.projection.current`, `state.projection.status`, and receipt diagnostics only.

- [ ] **Step 1: Write failing adapter tests**

Assert nodes/edges come from a verified revision, explicit execution and
handoff refs are preserved, membership/mount remain structural, and positions
do not affect edges. The adapter signature must reject raw Snapshot/Candidate
at compile time.

- [ ] **Step 2: Run adapter test and verify RED**

Run: `corepack pnpm vitest run tests/projection/canvasProjection.test.ts`

Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement adapter**

Map only verified semantic facts to existing `WbNode`/`WbEdge`. Apply stored
positions where present and leave absent positions at zero for the existing
display layout pass. Do not accept Snapshot or Activity parameters.

- [ ] **Step 4: Integrate existing store**

Add projection state and one pure recomputation helper. Invoke it after
Snapshot/project/Activity/Git inputs change. Recheck the digest at promotion
time. Keep last-good for invalid/stale builds within the same project and clear
cross-project last-good.

- [ ] **Step 5: Remove raw Canvas projection path**

Delete imports and use of `buildCanvasGraph`, `projectCompareGroups`, and
`projectTrajectory` from `CanvasView`. Render a status panel when current is
null; when current exists, render only `projectionToCanvasGraph(current)` and
show stale/needs-fix status without replacing its graph.

- [ ] **Step 6: Run tests and typecheck**

Run: `corepack pnpm vitest run tests/projection`

Run: `corepack pnpm typecheck`

Expected: both exit 0.

### Task 6: Complete verification and review handoff

**Files:**
- Modify only files required by failures proven by the commands below.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one reviewable feature commit, not merged to main.

- [ ] **Step 1: Run the full test suite**

Run: `corepack pnpm test`

Expected: zero failures; existing real-adapter skips may remain explicit.

- [ ] **Step 2: Run typecheck and production build**

Run: `corepack pnpm typecheck`

Run: `corepack pnpm build`

Expected: both exit 0.

- [ ] **Step 3: Audit boundaries**

Run: `git diff --check`

Run: `git status --short`

Run: `rg -n "buildCanvasGraph|projectCompareGroups|projectTrajectory" src/renderer/src/views/CanvasView.tsx`

Expected: no whitespace errors; only approved/justified files changed; Canvas
raw-projection search has no matches.

- [ ] **Step 4: Self-review the complete diff**

Check every acceptance item against a test, confirm no future-phase UI or
controller entered the diff, and verify attribution matches the exact donor
commit. Fix every Critical or Important issue with a failing regression test.

- [ ] **Step 5: Commit for review**

Run:

```text
git add src/core/projection tests/projection src/renderer/src/store.ts src/renderer/src/views/CanvasView.tsx THIRD_PARTY_NOTICES.md docs/superpowers
git commit -m "feat: add verified projection foundation"
```

Record final SHA and do not merge `main`.
