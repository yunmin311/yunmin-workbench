/**
 * Workbench dev/migration flag.
 *
 * Selects which renderer family the Workbench main window loads:
 *   WB_RENDERER_VNEXT=1   -> vNext renderer
 *   unset / any other     -> legacy renderer (default)
 *
 * Scope (PHASE 0): main / full window only. Compact/Edge Panel joins this flag
 * after the vNext renderer entry exists; until then it stays on whatever path
 * its own host owns.
 *
 * NOT a product fact. Never read from Overlay/Governance/ambient schema.
 * Never used to gate domain logic. Never persisted.
 */
export function isVNextRendererEnabled(): boolean {
  return process.env.WB_RENDERER_VNEXT === '1';
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
  env: { WB_RENDERER_VNEXT?: string },
): '../renderer-vnext/index.html' | '../renderer/index.html' {
  return env.WB_RENDERER_VNEXT === '1'
    ? '../renderer-vnext/index.html'
    : '../renderer/index.html';
}
