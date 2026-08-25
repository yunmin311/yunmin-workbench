import type { MemoryEntry } from '../types';

const LINK_RE = /^- \[(.+?)\]\((.+?)\)\s*—\s*(.*)$/;

/**
 * Parse overlay memory/MEMORY.md index into hook lines.
 * Only the index is loaded eagerly; atom bodies load on demand (PDF §5).
 */
export function parseMemoryIndex(markdown: string, sourceRef = 'memory/MEMORY.md'): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  let category = 'uncategorized';
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    const m = line.match(LINK_RE);
    if (!m) continue;
    const id = m[2].trim().replace(/\.md$/, '');
    entries.push({
      id,
      title: m[1].trim(),
      hook: m[3].trim(),
      category,
      sourceRef,
    });
  }
  return entries;
}
