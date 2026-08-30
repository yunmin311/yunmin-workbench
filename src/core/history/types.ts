import type { Observation } from '../types';

/**
 * Read-only History projection (Phase 1: Claude Code + Codex).
 *
 * Everything here is a *derived* view over transcripts the harnesses own. It is
 * never live Runtime truth: finding a session here means its transcript was
 * found on disk, nothing about whether anything is running, what the agent has
 * read, or what is in the current Context.
 */

export type HistoryHarness = 'claude-code' | 'codex';

/** Roles we can state from the transcript itself; `unknown` stays unknown. */
export type HistoryRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

// --- Discovery -------------------------------------------------------------

/** A discovered transcript file (csx `SessionFile`). */
export interface HistoryFileRef {
  /** Absolute path, for reading only. Not an identity. */
  path: string;
  /** Stable source-scoped dedupe/watermark key. */
  fileKey: string;
  /** Path relative to the harness root — provenance and display. */
  relativePath: string;
  size: number;
  mtimeMs: number;
}

/** One harness root on this machine. */
export interface HistoryRoot {
  harness: HistoryHarness;
  root: string;
  /** Extra roots (e.g. Codex `archived_sessions`) scanned as the same harness. */
  extraRoots?: string[];
}

// --- Parsed records --------------------------------------------------------

export interface HistoryMessage {
  id: string;
  /** Namespaced session identity. */
  sessionId: string;
  /** 0-based order within the transcript file, from the file, not from a clock. */
  seq: number;
  at?: string;
  role: HistoryRole;
  /**
   * Searchable/visible text, deliberately bounded (see EXCERPT_CHARS).
   * Bounding is recorded, never silent: `truncated` tells the UI the body was cut.
   */
  text: string;
  truncated: boolean;
  observed: Observation;
}

export interface HistorySession {
  sessionId: string;
  harness: HistoryHarness;
  /** The harness's own session/thread id, verbatim. */
  nativeId: string;
  /** Observed metadata only — never used as identity. */
  cwd?: string;
  title?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  /** fileKeys this session was assembled from (a session can span files). */
  sourceFiles: string[];
  /**
   * True when the transcript itself records a compaction. The transcript is then
   * known to be incomplete — surfaced, not hidden, and never back-filled.
   */
  compacted: boolean;
  /** Short excerpt of the first user turn, for list display. */
  preview: string;
  observed: Observation;
}

// --- Problems --------------------------------------------------------------

export type HistoryProblemKind =
  | 'unreadable'
  | 'json_parse'
  | 'invalid_structure'
  | 'missing_identity'
  | 'truncated_source'
  | 'cache_corrupt';

export interface HistoryProblem {
  fileKey: string;
  sourceRef: string;
  kind: HistoryProblemKind;
  message: string;
  lineNumber?: number;
}

// --- Incremental indexing --------------------------------------------------

/** Persisted per-file tail state (csx `files` row). */
export interface HistoryFileState {
  fileKey: string;
  path: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  /** Byte offset just past the last complete line consumed. */
  watermark: number;
  /** Lines already consumed, so problems can report a real line number. */
  lineCursor: number;
  sessionId?: string;
  indexedAt: string;
}

export interface HistoryLineInput {
  text: string;
  lineNumber: number;
}

export interface HistoryParseInput {
  fileKey: string;
  sourceRef: string;
  lines: HistoryLineInput[];
  /** Harness-native identity remembered from an earlier incremental batch. */
  nativeIdHint?: string;
  /** Sequence number to continue from across incremental passes. */
  startSeq: number;
  observedAt: string;
}

/**
 * Session metadata observed in one batch of lines. Incremental passes only see
 * the newly appended lines, so metadata arrives as a patch the indexer folds
 * into the stored session.
 */
export interface HistorySessionPatch {
  nativeId?: string;
  cwd?: string;
  title?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  compacted?: boolean;
}

export interface HistoryParseBatch {
  patch: HistorySessionPatch;
  messages: HistoryMessage[];
  problems: HistoryProblem[];
}

// --- Search ----------------------------------------------------------------

export interface HistoryQuery {
  text: string;
  harness?: HistoryHarness;
  /** Substring match on the observed cwd. A filter, never an identity claim. */
  cwdContains?: string;
  limit?: number;
}

/**
 * A search hit means *history was findable*. It is not "Context Included", not
 * "the agent read this", and not "runtime active" — the shape deliberately has
 * no field that could be mistaken for any of those.
 */
export interface HistoryHit {
  session: HistorySession;
  /** Best matching excerpt, with the matched span marked by SNIPPET_MARK. */
  snippet: string;
  /** True when the snippet body was cut by the index bound. */
  snippetTruncated: boolean;
  score: number;
}

export interface HistorySearchResult {
  hits: HistoryHit[];
  /** Query was empty or shorter than the minimum; caller shows it, we never guess. */
  emptyReason?: 'empty-query' | 'below-min-length';
  /** Non-fatal problems encountered while answering (e.g. an unreadable file). */
  problems: HistoryProblem[];
  stats: {
    sessions: number;
    messages: number;
    /** Files skipped because size+mtime were unchanged since the last pass. */
    filesSkipped: number;
    filesIndexed: number;
  };
}

export interface HistoryCatalogResult {
  sessions: HistorySession[];
  problems: HistoryProblem[];
  stats: HistorySearchResult['stats'];
}

export interface HistorySessionDetail {
  session: HistorySession;
  messages: HistoryMessage[];
  problems: HistoryProblem[];
}

/** Sentinel around the matched span in a snippet; the renderer never injects HTML. */
export const SNIPPET_MARK = '';

/** Bounded excerpt kept in this Phase 1 derived index and detail projection. */
export const EXCERPT_CHARS = 2000;
