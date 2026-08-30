import { historyMessageId, historySessionId } from './identity';
import type {
  HistoryMessage,
  HistoryParseBatch,
  HistoryParseInput,
  HistoryLineInput,
  HistoryProblem,
  HistorySessionPatch,
} from './types';
import { boundText, isRecord, mapRole, readString, summariseBlock } from './text';

/**
 * Claude Code transcript parser (`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`).
 *
 * Contract: one JSON object per line. Record `type` decides the shape; the
 * message body lives under `message.content` as either a string or an array of
 * blocks (`text` / `thinking` / `tool_use` / `tool_result`).
 *
 * Deliberate bounds:
 *   - `sessionId` and `session_id` are both read, but only here. Alias juggling
 *     stays in the adapter; core and UI see one identity.
 *   - `cwd` and `ai-title` are recorded as observed metadata and never used as
 *     the session key.
 *   - `tool_result` bodies are not indexed: they are mostly dumped file content,
 *     which would bloat the index and produce false hits. The tool call itself is
 *     still findable via its name.
 */

type ContentBlock = { kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'other'; text?: string; name?: string };

function readBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const out: ContentBlock[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    switch (block.type) {
      case 'text':
        out.push({ kind: 'text', text: readString(block.text) });
        break;
      case 'thinking':
        out.push({ kind: 'thinking', text: readString(block.thinking) });
        break;
      case 'tool_use':
        out.push({ kind: 'tool_use', name: readString(block.name) });
        break;
      case 'tool_result':
        out.push({ kind: 'tool_result' });
        break;
      default:
        out.push({ kind: 'other', name: readString(block.type) });
    }
  }
  return out;
}

function blocksToText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'tool_use') {
      parts.push(summariseBlock('tool', block.name));
      continue;
    }
    if (block.kind === 'tool_result') continue;
    if (block.kind === 'other') {
      if (block.name) parts.push(summariseBlock(block.name));
      continue;
    }
    if (block.text) parts.push(block.text);
  }
  return parts.join('\n').trim();
}

/** Both spellings occur in the wild; resolving them here keeps it out of core/UI. */
function nativeIdOf(record: Record<string, unknown>): string | undefined {
  return readString(record.sessionId) ?? readString(record.session_id);
}

export function parseClaudeCodeBatch(input: HistoryParseInput): HistoryParseBatch {
  const problems: HistoryProblem[] = [];
  const records: { line: HistoryLineInput; record: Record<string, unknown> }[] = [];

  for (const line of input.lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.text);
    } catch (error) {
      // Per-line isolation: one broken line is reported, the rest still index.
      problems.push({
        fileKey: input.fileKey,
        sourceRef: input.sourceRef,
        kind: 'json_parse',
        message: String(error instanceof Error ? error.message : error),
        lineNumber: line.lineNumber,
      });
      continue;
    }
    if (!isRecord(parsed)) {
      problems.push({
        fileKey: input.fileKey,
        sourceRef: input.sourceRef,
        kind: 'invalid_structure',
        message: 'line is not a JSON object',
        lineNumber: line.lineNumber,
      });
      continue;
    }
    records.push({ line, record: parsed });
  }

  const patch: HistorySessionPatch = {};
  let nativeId: string | undefined = input.nativeIdHint;
  for (const { record } of records) {
    const candidate = nativeIdOf(record);
    if (candidate) {
      nativeId = candidate;
      break;
    }
  }

  if (!nativeId) {
    problems.push({
      fileKey: input.fileKey,
      sourceRef: input.sourceRef,
      kind: 'missing_identity',
      message: 'no session id in this transcript; refusing to invent one from cwd, title or filename',
    });
    return { patch, messages: [], problems };
  }
  patch.nativeId = nativeId;

  const messages: HistoryMessage[] = [];
  let seq = input.startSeq;
  let firstAt: string | undefined;
  let lastAt: string | undefined;

  for (const { record } of records) {
    const type = readString(record.type);
    if (type === 'summary') patch.compacted = true;
    const at = readString(record.timestamp);
    if (at) {
      if (!firstAt) firstAt = at;
      lastAt = at;
    }
    const cwd = readString(record.cwd);
    if (cwd) patch.cwd = cwd;
    const gitBranch = readString(record.gitBranch);
    if (gitBranch) patch.gitBranch = gitBranch;

    if (type === 'ai-title') {
      const title = readString(record.aiTitle);
      if (title) patch.title = title;
      continue;
    }
    if (type !== 'user' && type !== 'assistant') continue;

    const message = isRecord(record.message) ? record.message : undefined;
    if (!message) {
      problems.push({
        fileKey: input.fileKey,
        sourceRef: input.sourceRef,
        kind: 'invalid_structure',
        message: `${type} record has no message body`,
      });
      continue;
    }

    const role = mapRole(readString(message.role), type === 'user' ? 'user' : 'assistant');
    const text = blocksToText(readBlocks(message.content));
    if (!text) continue;

    const bounded = boundText(text);
    const model = readString(message.model);
    if (model) patch.model = model;

    messages.push({
      id: historyMessageId(historySessionId('claude-code', nativeId), input.fileKey, seq),
      sessionId: historySessionId('claude-code', nativeId),
      seq,
      at,
      role,
      text: bounded.text,
      truncated: bounded.truncated,
      observed: {
        source: 'canonical-file',
        sourceRef: input.sourceRef,
        observedAt: input.observedAt,
        verification: 'OBSERVED',
      },
    });
    seq += 1;
  }

  if (firstAt) patch.startedAt = firstAt;
  if (lastAt) patch.endedAt = lastAt;

  return { patch, messages, problems };
}
