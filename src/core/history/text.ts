import { EXCERPT_CHARS, type HistoryRole } from './types';

/**
 * Bounded text extraction shared by the transcript parsers.
 *
 * The index keeps a bounded excerpt, never a full body: a 190 MB transcript
 * corpus must not become a 190 MB search index, and a hit only needs enough text
 * to show a meaningful snippet. `truncated` records that a cut happened so the
 * UI can say so instead of implying it has the whole message.
 */
export function boundText(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= EXCERPT_CHARS) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, EXCERPT_CHARS), truncated: true };
}

/** Unknown structured blocks are summarised by kind, never silently dropped. */
export function summariseBlock(kind: string, name?: string): string {
  return name ? `[${kind}: ${name}]` : `[${kind}]`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Harness role to Workbench role. Harness-specific names (Codex `developer`)
 * map to `system` rather than being folded into `user`: folding would
 * misattribute injected instructions to the human.
 */
export function mapRole(raw: string | undefined, fallback: HistoryRole): HistoryRole {
  switch (raw) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'developer':
      return 'system';
    default:
      return fallback;
  }
}
