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

## Todobar — `github.com/Leonxlnx/todobar` (public license) — DIRECTLY OBSERVED (2026-09-12, PHASE 4A.1)

Registered late: the donor existed publicly, but was missing from the Round-1/2
inventory — the earlier "DONOR NOT AVAILABLE" verdict in PHASE 4A reflected an
inventory gap, not reality. Product form: a right/left/top dockable edge todo
sidebar for macOS and Windows. Stack: Tauri (Rust) + React. Workbench reads its
WINDOW/DOCK MECHANISMS only; its task/product semantics are out of scope.

Read this round: `src-tauri/src/lib.rs` (whole file), `src-tauri/tauri.conf.json`
(window config), `src/sidebarSettings.ts` (dock settings), `src/App.tsx`
(`syncNativeWindow` ~L1259–1400, `syncHitTest` ~L1436–1600).

- **DIRECTLY OBSERVED (mechanisms)**:
  - window: `set_decorations(false)`, `set_resizable(false)`,
    `set_always_on_top(true)`, `set_skip_taskbar(true)`, transparent background
    (`tauri.conf.json`: `transparent/shadow:false/focus:false`)
  - dock geometry (`lib.rs` setup + `App.tsx` `syncNativeWindow`):
    `monitor_from_point(cursor)` → `currentMonitor()` fallback; full-height
    side dock; closed state sits OFF-SCREEN with only a 42px (×scale_factor)
    edge handle visible (`closed_offset = 2px×scale`); dockEdge right/left/top
    (bottom migrates to top); open/close native position animation
    (`animateNativePosition`, `motionMs` 230ms); `panelWidth` clamped against
    work area
  - click-through (`App.tsx` `syncHitTest`): transparent areas pass pointer
    events via polled cursor-vs-rect hit test → `setIgnoreCursorEvents`
    (two-interval polling, hover-reveal 650ms, cleanup restores false)
  - tray (`lib.rs` `setup_tray`): menu toggle(Alt+T)/Settings/Quit; left-click
    toggles; every route re-asserts `focus_main_window`
  - global shortcuts (`setup_global_shortcuts`): Alt+T / Alt+Shift+T; register
    failure logs and continues (fail-safe, same policy as Workbench)
  - single-instance (`tauri_plugin_single_instance`): second launch focuses
    the existing window
  - autostart (`tauri_plugin_autostart` + `launchAtLogin`, best-effort try/catch)

- **Workbench decision (PHASE 4A.1 audit vs `src/main/compactWindow.ts`)**:
  - **KEEP** (already equal or better-suited): single-instance via
    `app.requestSingleInstanceLock` + `second-instance` focus; fail-safe
    global shortcut register/unregister; close=hide lifecycle; bounds clamp +
    throttled persistence; frameless/alwaysOnTop/skipTaskbar; separate
    renderer surface with shared preload; no tray/autostart
  - **PATCH** (donor-informed fix, landed this round): closing the main window
    now destroys the hidden Compact window — otherwise `window-all-closed`
    never fires and the process lingers with no visible surface and no tray
    (the exact "running but unfindable" state Todobar avoids via explicit
    tray Quit). Landed in `src/main/index.ts` main-window `closed` handler +
    `e2e/compact-real.spec.ts` lifecycle test.
  - **DEFER** (recorded for a future phase, not implemented): true collapsed
    edge-handle form (off-screen closed geometry + 42px handle + hover-reveal
    + open/close animation); dock-edge settings (right/left/top);
    click-through for a transparent edge strip (Electron equivalent:
    `win.setIgnoreCursorEvents` with the same polled hit-test shape); tray
    (only if a "main closed but resident" product decision ever lands);
    autostart (Electron `app.setLoginItemSettings`)
  - **REJECT**: porting Tauri/Rust; transparent window + `shadow:false` +
    `focus:false` (Compact is an interactive focused surface with real
    content, no transparent dead zone); Todobar task/product semantics;
    `resizable:false` fixed-size dock (Workbench Compact resizes within
    clamped bounds)

## Ambient Island (in-repo) — `src/main/island.ts`, `src/core/ambient/island.ts` — IN-REPO MECHANISM DONOR

Not an external donor: this is Workbench's own validated Electron window
mechanism, reused as the implementation base for the Compact surface
(multi-display workArea selection, bounds clamping, throttled position
persistence, crash isolation, main-window lifecycle coupling). Todobar and the
Island are not alternatives — Todobar supplies external product/window
*behavior* references; the Island supplies the native Electron
*implementation* patterns both build on.

## Not adopted / out of scope

Scheduler/orchestrator patterns, conversation forking, dashboards, card
walls, permanent inspectors — REJECT in every donor per the Workbench
North Star.
