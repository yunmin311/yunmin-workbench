import { load } from 'js-yaml';
import type { HarnessInfo, Observation } from '../types';

const FALLBACK_OBSERVED: Observation = {
  source: 'canonical-file',
  sourceRef: 'unknown',
  observedAt: 'unknown',
  verification: 'UNKNOWN',
};

/**
 * Parse harness/manifest.yaml into a per-harness summary.
 * Control Room only needs health/binding hints; the full manifest stays canonical.
 */
export function parseHarnessManifest(yamlText: string, observed: Observation = FALLBACK_OBSERVED): HarnessInfo[] {
  const doc = load(yamlText) as Record<string, unknown> | null;
  if (!doc) return [];
  const out: HarnessInfo[] = [];

  const hooksByHarness = new Map<string, HarnessInfo['hooks']>();
  const hooksSection = doc.hooks as Record<string, unknown> | undefined;
  // manifest shape: hooks.<harness>.<list|map>; tolerate both
  if (hooksSection && typeof hooksSection === 'object') {
    for (const [harness, val] of Object.entries(hooksSection)) {
      const list: HarnessInfo['hooks'] = [];
      const entries = Array.isArray(val)
        ? val
        : typeof val === 'object' && val !== null
          ? Object.values(val as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : []))
          : [];
      for (const h of entries as Record<string, unknown>[]) {
        if (typeof h?.id === 'string') {
          list.push({
            id: h.id,
            event: String(h.event ?? ''),
            enforcement: String(h.enforcement ?? ''),
          });
        }
      }
      hooksByHarness.set(harness, list);
    }
  }

  const render = doc.render as Record<string, unknown> | undefined;
  const harnessNames = new Set<string>([...hooksByHarness.keys()]);
  if (render) for (const k of Object.keys(render)) if (k !== 'vars') harnessNames.add(k);
  const plugins = doc.plugins as Record<string, unknown> | undefined;
  if (plugins) for (const k of Object.keys(plugins)) harnessNames.add(k);

  for (const name of harnessNames) {
    if (name === 'claude' || name === 'codex' || name === 'deepseek' || harnessNames.size === 0) {
      const renderCfg = render?.[name] as Record<string, unknown> | undefined;
      const pluginCfg = plugins?.[name];
      const pluginsEnabled = Array.isArray(pluginCfg)
        ? pluginCfg.filter((p) => (p as Record<string, unknown>)?.enabled !== false).length
        : Array.isArray((pluginCfg as Record<string, unknown>)?.enabled)
          ? ((pluginCfg as Record<string, unknown>).enabled as unknown[]).length
          : 0;
      out.push({
        harness: name,
        model: typeof renderCfg?.model === 'string' ? renderCfg.model : undefined,
        pluginsEnabled,
        hooks: hooksByHarness.get(name) ?? [],
        observed,
      });
    }
  }
  return out;
}
