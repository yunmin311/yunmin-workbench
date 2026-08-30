import type { HistoryHarness } from './types';

/**
 * History identity — adapted from Klovi's `pluginId::rawSessionId` scheme.
 *
 * A history record's identity is namespaced by the harness that produced it and
 * keyed by that harness's own native session id. Nothing else may compose an
 * identity:
 *
 *   cwd          — two sessions can share a directory; a directory is not a session
 *   file name    — paths move, get archived and get copied; a path locates, it does not identify
 *   title / slug — `ai-title` and `thread_name` are derived, unstable, and can collide
 *
 * Those are still recorded (as observed metadata on the session) because they are
 * real external facts; they are just never used as the key.
 */
const SEPARATOR = '::';

export function historySessionId(harness: HistoryHarness, nativeId: string): string {
  return `${harness}${SEPARATOR}${nativeId}`;
}

export interface ParsedHistorySessionId {
  harness: HistoryHarness;
  nativeId: string;
}

export function parseHistorySessionId(sessionId: string): ParsedHistorySessionId | null {
  const separatorIdx = sessionId.indexOf(SEPARATOR);
  if (separatorIdx === -1) return null;
  const harness = sessionId.slice(0, separatorIdx);
  if (harness !== 'claude-code' && harness !== 'codex') return null;
  const nativeId = sessionId.slice(separatorIdx + SEPARATOR.length);
  if (!nativeId) return null;
  return { harness, nativeId };
}

/**
 * Stable, source-scoped key for a transcript file — the dedupe and watermark
 * key (csx `SessionFile.file_key`). It is derived from the path on purpose: this
 * identifies *the file being tailed*, not the conversation inside it.
 */
export function historyFileKey(harness: HistoryHarness, relativePath: string): string {
  return `${harness}${SEPARATOR}${normalizeHistoryPath(relativePath)}`;
}

/** Locator for provenance, matching the existing `overlay:` / `project-file:` refs. */
export function historySourceRef(harness: HistoryHarness, relativePath: string): string {
  return `history:${harness}:${normalizeHistoryPath(relativePath)}`;
}

export function normalizeHistoryPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function historyMessageId(sessionId: string, fileKey: string, seq: number): string {
  return `${sessionId}${SEPARATOR}${encodeURIComponent(fileKey)}${SEPARATOR}m${seq}`;
}
