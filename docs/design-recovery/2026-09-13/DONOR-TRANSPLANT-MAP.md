# DONOR-TRANSPLANT-MAP

This map is pinned to inspected source, not screenshots or style adjectives.

## Source pins and license boundary

| Donor | Inspected revision | License consequence |
| --- | --- | --- |
| DeepSeek Reasonix (`main-v2`) | `8d2259ee82ed170bb1e094dfa717d5e3bf600905` | MIT. Structure and implementation may be transplanted with notice. |
| dsh-synapse (`main`) | `56935dc1862e7791b212f6eb2dd26404def5a575` | MIT. Canvas camera, viewport and selection implementation may be transplanted with notice. |
| OpenCode (`dev`) | `95daf90670b7c039c436c85537da5fbfe2205b41` | MIT. Sidebar rail and composer request-dock implementation may be transplanted with notice. |
| Agent Cockpit (`main`) | `65ae7d41c7021ad5a2ba1baf5a760bb9c826bd31` | No license was present at the inspected revision. Information architecture can be verified; source must not be copied. |
| LinkCode (`master`) | `22c337f197665e1c53cc717b88859a45cfd8a43d` | BUSL 1.1. Use as semantic/interaction evidence only; no source transplant into a distributed Workbench build. |
| Claude Code Agent View / Codex desktop | closed product surfaces | Behavior cross-check only. Do not invent source provenance or clone branding. |

## Surface map

### Canvas / spatial workspace

**Workbench surface →** the central Work plane: bounded workspace, movable task objects, pan/zoom/focus, selection and contextual deep dive.

**donor project →** dsh-synapse.

**donor component/file/code location →** `app.js:553-587` (connector cache updated during drag), `app.js:590-617` (open at newest active work and preserve locked positions), `app.js:985-1033` (viewport-coordinate culling and incremental mount), `app.js:1036-1060` (viewport/content/SVG/card-layer composition), `app.js:1338-1366` (cursor-centered bounded zoom), `app.js:1376-1398` (focus target comes from data, not mounted DOM), `app.js:1427-1512` (selection/pan gesture separation), `styles.css:287-289` (inspector becomes a bottom dock at narrow widths).

**直接复用什么 →** the camera transform formula, 0.6–4 zoom clamp, newest-active focus rule, world-coordinate viewport culling, incremental card mounting, connector-cache update path, drag/pan/text-selection gesture exclusion, and data-model-based focus. The isolated comps reuse the same structural layers: viewport → transformed world → relation SVG → objects.

**必须改什么 →** replace conversation-turn graph cards with Work-owned spatial objects: a Work brief, task clusters, a context shelf and a send lane. Relations describe product flow, not inferred conversational lineage. The right inspector must occupy a dock track, never cover the workspace.

**禁止自行重写什么 →** camera math, DOM-derived focus, full-canvas rebuild on pan, guessed relations, free-floating inspectors, or a ReactFlow-style debug graph substituted for the workspace.

### Team / Agent / Runtime panel

**Workbench surface →** persistent people/runtime dock with Needs you, Working and Recent groups; select a session to inspect approvals, timeline, diff and evidence.

**donor project →** Agent Cockpit for verified IA; OpenCode for transplantable rail mechanics.

**donor component/file/code location →** Agent Cockpit `packages/ui/src/components/layout/OpsLayout.tsx:17-76` (56px persistent session topbar + overflow-contained main), `SessionListPanel.tsx:127-175` (filters, explicit session list, independent scroll, launch/terminate), `components/sessions/SessionCard.tsx:40-109` (provider, project, subagent count, approval count, state and capability-gated terminate), `SessionDetailPanel.tsx:14-20,59-117` (Approvals/Timeline/Diff/Memory/Artifacts tabs and independently scrolling outlet). OpenCode `packages/app/src/pages/layout/sidebar-shell.tsx:35-47,49-123` (64px persistent rail, expanded panel is inert and non-interactive when closed, `min-h-0 min-w-0 overflow-hidden`).

**直接复用什么 →** from OpenCode: the 64px rail/expandable-panel DOM and inert/pointer-event contract. From Agent Cockpit: the exact row information order and session-to-detail navigation model, reimplemented rather than copied because its repository has no license.

**必须改什么 →** group rows by Workbench attention semantics instead of a flat process list; replace terminate/launch with permitted Workbench actions; use canonical runtime state and show UNKNOWN explicitly; translate detail tabs to Context, Activity and Evidence where those facts exist.

**禁止自行重写什么 →** decorative “agent profile” cards, an office metaphor, inferred active states, a second task list, provider-colored card families, or a panel that floats over the Work plane.

### Persistent working / session presence

**Workbench surface →** always-visible current Work and live/waiting/needs-you presence across Full, Focused, Send-ready and Compact.

**donor project →** OpenCode + Agent Cockpit behavior cross-check.

**donor component/file/code location →** OpenCode `sidebar-shell.tsx:50-118` (rail never leaves layout; scroll is contained), Agent Cockpit `OpsLayout.tsx:10-16,41-48,66-72` (active sessions remain in chrome while the routed main changes), `SessionCard.tsx:63-84` (subagent, approval and status are separate signals).

**直接复用什么 →** the permanent rail geometry and the separation of provider/session identity, runtime state, subagent count and pending attention.

**必须改什么 →** pin the selected Work above sessions; collapse the rail at 900px without removing presence; use `working / waiting / needs you / recent` only when sourced by existing semantics.

**禁止自行重写什么 →** a transient dashboard, presence derived from timestamps, hiding all runtime state when a detail view opens, or combining approval and execution into one ambiguous badge.

### Docking / overlay / resize system

**Workbench surface →** global composition contract shared by Work rail, Canvas, contextual dock, composer and any exceptional modal.

**donor project →** Reasonix.

**donor component/file/code location →** `desktop/frontend/src/styles.css:136-166` (named z-index tiers), `styles.css:2082-2178` (grid rows/columns, permanently present zero-width workspace track, collapsed-sidebar variants and minimum widths), `styles.css:24162-24245` (`workbench-dock` fixed to grid track, 42px tools, `flex:1 min-height:0 overflow:hidden`, container-query label collapse).

**直接复用什么 →** named z tiers instead of local numbers; a permanent dock track that collapses to zero instead of snapping into an overlay; `minmax(0,1fr)`, `min-width:0`, `min-height:0` and independently scrolling dock body; width-driven label collapse.

**必须改什么 →** Workbench adds the 64px OpenCode-style presence rail and uses a 320px detail/runtime dock. At 900px the same dock becomes a 188px bottom grid row rather than an overlay.

**禁止自行重写什么 →** component-local z-index escalation, absolutely positioned permanent panels, body-level overflow as a containment fix, drag handles with a visual-only hit target, or viewport rules that depend on one screenshot size.

### Composer / contextual action surface

**Workbench surface →** one in-flow surface that morphs Context → Prepare → Send → Running.

**donor project →** Reasonix + OpenCode.

**donor component/file/code location →** Reasonix `desktop/frontend/src/components/Composer.tsx:3927-3975` (trigger-anchored popover owned by composer), `Composer.tsx:4251-4278` (context objects rendered inside composer), `Composer.tsx:4378-4405` (semantic resize separator and in-card running strip), `styles.css:6382-6630` (centered max width, visible anchored overflow, resize hit target, in-flow run strip). OpenCode `session-composer-region.tsx:23-83,126-165` (single prompt dock owns question, permission, todo, follow-up and prompt; bounded animated height; pointer events disabled while closed), `session-question-dock.tsx:131-151,176-206` (max height measured between sticky header and dock bottom with ResizeObserver).

**直接复用什么 →** composer-owned context shelf; semantic resize handle; in-flow status strip; request surfaces mounted in the same dock; measured max-height and `min-height:0` containment; one centered max-width action column.

**必须改什么 →** context chips become staged Workbench context with used/available distinction; OpenCode question/permission modes become Prepare and Send review states; styling follows Workbench paper/graphite tokens.

**禁止自行重写什么 →** detached command palette as the primary action, a modal for ordinary prepare/send, floating composer over Canvas, context displayed outside the sending surface, or separate composers for each phase.

### Context / detail / approval / evidence

**Workbench surface →** selected Task detail dock with staged context, provenance, approval/evidence and activity.

**donor project →** OpenCode for request docks; Agent Cockpit and LinkCode for verified IA/semantics.

**donor component/file/code location →** OpenCode `session-permission-dock.tsx:22-72` (permission header, explanation/patterns and ordered deny/always/once actions inside `DockPrompt`). Agent Cockpit `ApprovalInbox.tsx:127-237` (risk rail → requested action → affected paths/why risky → decisions), `SessionDetailPanel.tsx:14-20,101-117` (stable detail tabs). LinkCode `packages/presentation/ui/src/shell/permission-prompt.tsx:11-48,105-159` (provenance and deterministic option priority), `question-prompt.tsx:18-19,41-92` (atomic request, per-question draft, explicit skipped answers).

**直接复用什么 →** OpenCode's MIT `DockPrompt` composition and action ordering. Agent Cockpit/LinkCode contribute the evidence order only: identity/provenance first, requested action, affected scope, reason, then decision.

**必须改什么 →** map permission choices to the Workbench's real approval contract; show source refs and UNKNOWN without synthesis; keep available context separate from staged/used context.

**禁止自行重写什么 →** generic warning cards, approval without affected scope, evidence invented from UI state, silently treating “available” as “used”, or copying BUSL/unlicensed source.

### Compact edge surface

**Workbench surface →** a docked edge companion for the current Work, immediate attention and one next action—not a miniature dashboard.

**donor project →** OpenCode rail mechanics + Workbench's existing Compact window lifecycle; Claude Code Agent View/Codex only as behavior checks.

**donor component/file/code location →** OpenCode `sidebar-shell.tsx:35-47,50-123` (persistent narrow rail, contained scrolling, inert collapsed content); Workbench existing lifecycle remains in `src/main/compactWindow.ts` and its IPC/state contracts (not modified in this phase).

**直接复用什么 →** the narrow persistent hierarchy: current identity, one attention row, one runtime row and one action. Reuse existing Workbench window lifecycle later, after visual approval.

**必须改什么 →** compose for a 368px edge width; Compact returns to the same Task/Work and opens the same Prepare surface; use no extra navigation taxonomy.

**禁止自行重写什么 →** window lifecycle/IPC, a second state machine, mini-Canvas, miniature multi-panel dashboard, hover-only critical actions, or a non-interactive status widget.

## Shared docking and viewport contract

- `>= 1100px`: columns `64px 248px minmax(0,1fr) 320px`; all four are in normal flow.
- `< 1100px`: columns `64px minmax(0,1fr)`; context/runtime dock moves to a `188px` bottom track. It never becomes an overlay.
- Every grid/flex child that can shrink has `min-width:0` and `min-height:0`.
- Only declared scroll bodies use `overflow:auto`; shell, stage and docks use `overflow:hidden`.
- Z tiers transplanted from Reasonix `styles.css:136-166`: content 1, sticky 20, workspace float 40, app chrome 70, drawer 90, dock 100, modal 1200, toast 1301, tooltip 1302.
- No object may protrude outside the spatial viewport. Canvas affordances live inside a 12px safe inset.

## Old renderer disposition after visual approval

Nothing below is deleted or rewired in this design-only phase.

**Delete/replace as visual implementation:** `src/renderer-vnext/src/components/canvas/WorkGraphCanvas.tsx` composition and ReactFlow surface, `src/renderer-vnext/src/components/canvas/nodes.tsx`, the layout rules in `src/renderer-vnext/src/styles/index.css`, the visual shells in `ContextCabinet.tsx` and `DispatchSurface.tsx`, and the markup/styles in `src/renderer-compact/CompactApp.tsx` + `compact.css`.

**Archive after the new route takes over:** the older `src/renderer/src/views/CanvasView.tsx`, `CompareView.tsx`, `ContextStagingView.tsx`, `SessionSurface.tsx`, `reasonixProjectionLayout.ts`, plus legacy visual panels whose functions are replaced by the single dock (`WorkspaceSidebar`, `InspectorPane`, `AttentionPanel`, `RuntimeInspector`, `SessionComposer`, `PacketPanel`).

**Must survive and be reconnected:** projection validation and stable identity (`workGraphView.ts` and core Projection IR), canonical/provenance rules, Context staging state, frozen Packet and dispatch domain functions, IPC/preload contracts, runtime receipts, Compact snapshot/handoff/window lifecycle, and any store selectors/actions that implement those contracts. Visual files are not permission to delete domain behavior embedded in them; extraction precedes removal.
