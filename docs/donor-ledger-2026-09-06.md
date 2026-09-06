# Donor Ledger — 2026-09-06 (Round 2: real source observation)

Round 1 relied on the in-repo adoption map only. Round 2 fetched and read the
actual donor sources over the network. Every row now states how it was
learned: DIRECTLY OBSERVED (read the current upstream source/docs this round),
NOT ACCESSIBLE (tried and could not read), plus the decision and the exact
Workbench landing.

## Archify — `github.com/tt-a1i/archify` (MIT) — DIRECTLY OBSERVED

Read this round: `DESIGN.md`, `docs/research-authored-reachability-2026-07-23.md`,
`archify/test/authored-reachability.test.mjs`, repo tree (`archify/renderers/*`,
`archify/delta`).

- **DIRECTLY OBSERVED**: authored reachability is *canvas viewer state*, not a
  panel: `#focus-reach` hidden container, `btn-reach-upstream/downstream` with
  `aria-pressed="false"`, `svg.setAttribute('data-reach-active', direction)`,
  and the canonical SVG asserted free of `data-reach-*`. Deterministic BFS
  with `depths` map, cycle safety, edge-fragment dedupe by stable key,
  `maxDepth`. Repeat action clears while preserving node focus. Research doc:
  "no new panel or permanent toolbar action", "no geometry mutation and no
  reachability state in canonical exports"; receipts "say nodes, links, and
  maximum hops; never blast radius".
- **ADAPT** → landed `src/renderer/src/reachHighlight.ts` +
  `CanvasView.tsx`: when a Reach result is open, the canvas keeps origin
  (`reach-origin` ring) and the reachable subgraph (`reach-hit`) strong while
  unrelated topology recedes (`reach-dim`), plus a count/direction chip in the
  canvas panel. Classes are computed at render from the Reach result —
  no layout, IR, or semantic-hash writes (Workbench's canonical-clean rule).
- **ADAPT (Round 1, re-validated against source)**: surface ownership —
  Archify routes details through the Passport and forbids extra panels;
  our one-proof-surface rule matches.
- **REJECT**: share cards, repo proof, SVG-specific traversal, diagram
  boundary topology, `#focus=<id>&reach=…` URL state (Workbench has no
  canonical URL surface yet).

## dsh-synapse — `github.com/liangmianya/dsh-synapse` (MIT) — DIRECTLY OBSERVED (README/feature docs; source not deep-read this round)

- **DIRECTLY OBSERVED**: "追问更顺手 — 选中回答中的文字可直接带入新的追问"
  (selected answer text carries directly into a new follow-up); native DSH
  session stays the single source of truth; the map only projects committed
  events; bidirectional context sync between map and conversation.
- **ADAPT** → landed `src/renderer/src/sessionFollowUp.ts` +
  `SessionSurface.tsx`: selecting text in the transcript raises a transient
  cue; one click prepends the quoted selection to the existing composer draft.
  No transcript mutation, no new panel.
- **REJECT**: fork/branch management, canvas layout persistence, plugin
  hosting model.

## Claude Code Agent View — `code.claude.com/docs/en/agent-view` — DIRECTLY OBSERVED (official docs; closed-source CLI)

- **DIRECTLY OBSERVED**: one keypress ("left arrow from any session") reaches
  a grid of all sessions; sessions needing input are visually marked in the
  overview.
- **ADAPT (already landed in earlier phases, re-validated)**: session rail
  marks NEEDS APPROVAL / RUNNING; Attention badge counts; palette reaches
  every surface. No new landing this round — nothing above the existing bar.
- **REJECT**: tmux-style grid as a replacement for the session spine
  (Workbench keeps one permanent session surface).

## DeepSeek-Reasonix — `github.com/esengine/DeepSeek-Reasonix` — PARTIALLY ACCESSIBLE

Found the repo and its desktop-UI refresh discussion (#3805: centered home
workspace, project-aware composer, quieter dark surface); did not deep-read
its composer source this round.
- **ADAPT (Round 1, landed)**: composer session-continuity default
  (`SessionComposer.tsx` defaults to the open session's harness).
- **NOT ACCESSIBLE (deep source)**: composer internals not read this round;
  the Round-1 landing was guided by the in-repo adoption map, not source.

## Not adopted / out of scope

Scheduler/orchestrator patterns, conversation forking, dashboards, card
walls, permanent inspectors — REJECT in every donor per the Workbench
North Star.
