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

Core is correct: re-trust gate, exact edges, deterministic sorts, route
tie-break all verified by tests AND real UI. Issues to fix before merge are
product-integration issues above (P1-1 stacking, P2-2 label/clipping), not
core semantics.

## Non-goals (unchanged)

No scheduler/orchestrator, no identity/relation inference from
cwd/provider/time/label/geometry, no new permanent Inspector, UI is never a
source of truth, UNKNOWN stays UNKNOWN.
