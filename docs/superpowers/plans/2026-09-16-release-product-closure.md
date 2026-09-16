# Release / Product Closure Implementation Plan

> Spec: user-approved Release / Product Closure request in the current task (2026-09-16).

**Goal:** Close the verified feature branch into an unsigned Windows release candidate with production evidence, safe packaged execution, honest persistence boundaries, and independent CI proof.

**Architecture boundary:** Preserve the frozen renderer, canonical/overlay ownership, runtime authority, process substrate, and harness contracts. Only fix packaging or persistence defects that block safe installation or upgrade.

**Tech stack:** Electron 34, electron-vite, React, TypeScript, pnpm, Vitest, Playwright Electron, GitHub Actions, Windows packaging.

---

## Task 1: Inventory release and persistence boundaries

- Inspect main-process paths, state readers/writers, app identity, build output, existing CI, and current Electron E2E fixtures.
- Record packaged-vs-dev user-data behavior, schema/corruption behavior, user-owned file boundaries, and Unicode/space-path coverage.
- Add focused regression tests only for concrete release blockers found.
- Run focused tests before and after each blocker fix.

## Task 2: Produce and smoke a Windows package

- Add the smallest packaging configuration and scripts required for an unsigned Windows artifact.
- Ensure the package contains compiled production renderers/preload/main code and required runtime dependencies, not dev-server assumptions.
- Add a portable packaged smoke using an isolated state directory and portable project fixture.
- Verify launch, IPC, project/work graph, Context Cabinet, Compact, harness availability, restart, single-instance behavior, state and Compact geometry persistence, and clean shutdown.
- Verify install/uninstall or, if no installer is created, explicitly identify the artifact as portable/unpacked and do not imply signing.

## Task 3: Capture current production evidence and refresh README

- Run the current production Electron build without DevTools.
- Capture only real product states that explain Full, Focused Task, Context, Send-ready, Running/Result when safely available, and Compact.
- Replace README claims with current verified capabilities and explicit limitations for Claude, Codex, OpenCode, and DeepSeek.
- Explain the product path, verified-projection boundary, startup, data ownership, Windows artifact/signing status, and limitations in a 3–5 minute read.
- Validate every local image/link and ensure no prototype/design-recovery image is referenced as production.

## Task 4: RC verification and delivery

- Run typecheck, unit tests, build, hermetic Electron E2E, packaged Windows smoke, README link/image validation, and `git diff --check`.
- Create separated commits only for categories that actually changed.
- Push `codex/workbench-vnext` normally, without force/rebase/merge.
- Wait for GitHub Actions to finish and fix only real release blockers.
- Confirm clean working tree and local/remote HEAD equality; do not tag or publish a release.
