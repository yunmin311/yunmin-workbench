/**
 * Renderer rollout (activation complete).
 *
 * vNext is the default product: a normal launch always opens the vNext
 * Workbench. The legacy prototype chrome remains ONLY as an explicit
 * rollback/debug fallback, never as default and never as a user-facing
 * edition picker:
 *   WB_RENDERER_LEGACY=1 -> legacy renderer (../renderer/index.html)
 *   unset / anything else -> vNext renderer (../renderer-vnext/index.html)
 *
 * The retired WB_RENDERER_VNEXT flag is ignored: anything that is not an
 * explicit legacy opt-in opens vNext.
 *
 * NOT a product fact. Never read from Overlay/Governance/ambient schema.
 * Never used to gate domain logic. Never persisted.
 */
export function isLegacyRendererEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WB_RENDERER_LEGACY === '1';
}

/**
 * Compact / Edge Panel dev/migration flag (PHASE 4A). Launches the separate
 * Compact window alongside the main window. NOT a product mode: the Compact
 * surface's default rollout is decided after real product acceptance.
 */
export function isCompactWindowEnabled(): boolean {
  return process.env.WB_COMPACT_WINDOW === '1';
}

/** The single集中-defined toggle accelerator; overridable for dev, never user-hostile defaults. */
export function compactToggleShortcut(): string {
  return process.env.WB_COMPACT_TOGGLE_SHORTCUT || 'Alt+Shift+B';
}

export function rendererEntryForEnvironment(
  env: { WB_RENDERER_LEGACY?: string },
): '../renderer-vnext/index.html' | '../renderer/index.html' {
  return env.WB_RENDERER_LEGACY === '1'
    ? '../renderer/index.html'
    : '../renderer-vnext/index.html';
}
