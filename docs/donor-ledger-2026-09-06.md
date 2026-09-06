# Donor Ledger — 2026-09-06

Honesty note: the donor repositories (Archify, Reasonix, dsh-synapse, Claude
Code Agent View) are not present on this machine; this round's learning is
grounded in the in-repo adoption map (`docs/product-rebuild-adoption-map.md`),
`THIRD_PARTY_NOTICES.md`, and this round's direct product audit. Every ADAPT
row below names the file/interaction where it landed in this round — rows
without a landing are marked OPEN and are not claimed as learned.

| Donor mechanism | Workbench gap (audited) | Decision | Landed this round |
|---|---|---|---|
| Archify · focused proof surface with progressive disclosure (identity → current → evidence → changes; details on demand) | Passport dumped 3–6 limitation paragraphs, raw receipt JSON, and full sha256 ids as permanent walls | ADAPT | `SemanticPassportDrawer.tsx` — limitations/receipt behind `<details class="disclose">`, short evidence ids with full id on hover/title |
| Archify · exact navigation as a focused viewer state, never a dashboard | Reach/Route stacked a third drawer over Passport over Runtime Inspector | ADAPT | `store.ts` surface ownership (one proof surface at a time), `ReachRouteSurfaces.tsx` in-place drill-down with return; edges section renamed "Reachable edges" with exact semantics |
| Archify · structured failure/limitation receipts (kept, not deleted) | Limitations text existed but was noise by placement | ADAPT (kept, moved behind disclosure) | same as above |
| Reasonix · composer owns agent continuity (session-aware default) | Composer defaulted to the first available harness even when the open session ran on another | ADAPT | `SessionComposer.tsx` — default = open session's platform when dispatchable |
| Reasonix · single command entry that reaches every surface | Demo Workspace became unreachable after a real workspace existed | ADAPT | `CommandPalette.tsx` — "Open Demo Workspace (sandboxed)" action |
| Claude Code Agent View · session-first status: signals navigate to the work, not just list it | Attention approval item was a dead end (dismiss only for most kinds) | ADAPT | `AttentionPanel.tsx` — every attention item with a resolvable exact execution gets "Inspect runtime" |
| dsh-synapse · source-linked relations; coordinates presentation-only | Canvas execution node force-opened two stacked surfaces | ADAPT (ownership), REJECT (any layout→relation reading) | `CanvasView.tsx` `handleCanvasNodeClick` — Inspector only; Passport via explicit Inspector cross-jump |
| Archify · Evidence Console as evidence records | Inspector "Evidence" tab actually showed source-of-truth bindings | REIMPLEMENT (honest naming) | `InspectorPane.tsx` — tab renamed "Binding" |
| Archify · repo proof / share cards / SVG traversal | not applicable to v0 | REJECT | — |
| Any donor · layout-derived or heuristic relationships | trust boundary | REJECT | unchanged (Reach/Route build edges only from exact fields) |

Carried-over landings from earlier phases (still in place, verified this
round): verified projection last-known-good, receipt≠completion wording,
honest UNKNOWN states, demo sandboxing.
