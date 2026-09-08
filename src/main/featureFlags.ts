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

export function rendererEntryForEnvironment(
  env: { WB_RENDERER_VNEXT?: string },
): '../renderer-vnext/index.html' | '../renderer/index.html' {
  return env.WB_RENDERER_VNEXT === '1'
    ? '../renderer-vnext/index.html'
    : '../renderer/index.html';
}
