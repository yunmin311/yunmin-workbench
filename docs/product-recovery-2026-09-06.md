# Product Recovery Audit — 2026-09-06

Evidence: real Electron walkthrough (`pnpm dev`), demo + real workspace
(`GOV_OVERLAY=E:\1project\ai-governance-system`), screenshots via desktop
automation. This file is the single recovery queue. P0 = main path broken;
P1 = core friction; P2 = capability not productized; P3 = polish.

## What actually works (verified in real UI)

First Run gate; Demo full loop (session switch, composer dispatch →
transcript → Use as context, Attention, Runtime Inspector 5 tabs, Map,
Passport, Reach/Route, Compare, palette); Real workspace discovery and real
session open (given GOV_OVERLAY); honest UNKNOWN/empty states throughout.

## Queue (fixed priority order)

- **P0-1 Real-workspace entry is broken in the common layout.** Overlay
  discovery scans only drive-root depth-1 for `overlay.yaml`; the user's real
  overlay lives at `E:\1project\ai-governance-system` (depth 2) and there is
  no in-app way to point at an overlay, so "Open real workspace" always says
  `no overlay found (set GOV_OVERLAY)`. Fix: bounded depth-2 scan keeping the
  exactly-one-candidate rule (never guess), plus an in-app folder picker on
  the First Run / no-overlay state that binds the overlay for the session.
- **P1-1 Surface stacking.** Canvas execution click force-opens Runtime
  Inspector AND Semantic Passport; Passport drawer covers the Inspector;
  Reach/Route stack on top of Passport (4 overlapping surfaces in one region).
  Fix: one focused proof surface at a time; explicit cross-jump instead of
  implicit double-open; Reach/Route replace the Passport drawer and return.
- **P1-2 Attention is a dead end.** Approval signal panel offers only
  Dismiss; clicking the card closes without navigating to the session event
  or runtime inspector. Fix: navigate to the source session/event.
- **P1-3 Composer agent default ignores the session harness.** A DEEPSEEK
  session opens with composer default `codex`. Fix: default to the session's
  own harness when known; keep explicit override.
- **P1-4 Noise walls / developer dumps.** Limitations paragraphs (3–6 long
  English lines) permanently visible in Passport/Reach/Route; 64-char
  evidence ids as dominant content; receipt raw JSON in Passport; real
  session title (a full paragraph) rendered as a 3-line H1 and repeated in
  governance bar/rail. Fix: progressive disclosure (`<details>`), short ids
  with expand, clamped titles with full text one click away.
- **P2-1 Inspector "Evidence" tab shows a binding summary, not evidence.**
  Rename to what it is (Binding) or merge into Runtime.
- **P2-2 Reach "Traversed edges" label.** The IR set is "every exact edge
  whose both endpoints are reachable" (includes redundant edges). Core is
  correct; label + limitation wording must say reachable-subgraph edges.
  Also fix row overflow/clipping in the Reach surface.
- **P2-3 Undeclared projects surface raw keys** (`(Desktop\人工智能-系统学习)`).
  Honest provenance; acceptable, keep.

## codex/reach-route-v0 review (branch pending merge)

Core semantics verified: re-trust gate, exact edges. Round 2 hardened the
identity layer: `stableEdgeKey` is now a length-prefixed canonical tuple
encoding (no delimiter assumptions — Foundation does not restrict id
characters), and all stable ordering / Route equal-hop tie-breaks use an
explicit codepoint comparator (`compareEdges`) instead of the
locale-dependent `localeCompare`. Collision and locale-independence
regressions live in `tests/projection/reach.test.ts` and
`tests/projection/route.test.ts`. Product-integration fixes (surface
ownership P1-1, "Reachable edges" label P2-2) landed on main via the
recovery merge.

## Round 2 (2026-09-06, later the same day)

- **Trust fix**: the encoding/ordering hardening above; earlier
  "deterministic contract verified" claims are withdrawn until this landed —
  it has now landed with regressions.
- **Donor research executed against real sources** (see
  `docs/donor-ledger-2026-09-06.md`): Archify (`tt-a1i/archify` DESIGN.md +
  authored-reachability test + research doc), dsh-synapse README, Claude
  Code Agent View docs. Two mechanisms landed:
  1. Archify canvas reach highlight — viewer-only, origin ring + reachable
     subgraph strong, unrelated topology dimmed (`reachHighlight.ts`,
     `CanvasView.tsx`); verified in real Electron.
  2. dsh-synapse selected-text follow-up — transient cue above the composer
     prepends the quoted selection to the existing draft
     (`sessionFollowUp.ts`, `SessionSurface.tsx`); verified in real Electron.
- **memory.spec root-caused and fixed**: the spec closed the app while the
  debounced draft save (350 ms) was still pending, so the resumed app found
  no draft. Two-part fix: the product now flushes pending draft/workspace
  saves when a window close is requested (main holds the close until the
  renderer confirms or a 1.5 s deadline fires), and the spec waits for the
  production "Draft saved" signal before closing. No assertion weakened;
  spec passes.
- Real-overlay walkthrough re-run on the current build: launch → resume →
  context → map → passport → reach (highlight) → return, all clean.


## Non-goals (unchanged)

No scheduler/orchestrator, no identity/relation inference from
cwd/provider/time/label/geometry, no new permanent Inspector, UI is never a
source of truth, UNKNOWN stays UNKNOWN.
