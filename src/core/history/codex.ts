import { historyMessageId, historySessionId } from './identity';
import type {
  HistoryMessage,
  HistoryParseBatch,
  HistoryParseInput,
  HistoryProblem,
  HistoryRole,
  HistorySessionPatch,
} from './types';
import { boundText, isRecord, mapRole, readString, summariseBlock } from './text';

function problem(input: HistoryParseInput, kind: HistoryProblem['kind'], message: string, lineNumber?: number): HistoryProblem {
  return { fileKey: input.fileKey, sourceRef: input.sourceRef, kind, message, lineNumber };
}

function payloadText(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.content)) return '';
  const parts: string[] = [];
  for (const block of payload.content) {
    if (!isRecord(block)) continue;
    const kind = readString(block.type);
    if (kind === 'input_text' || kind === 'output_text' || kind === 'text') {
      const text = readString(block.text);
      if (text) parts.push(text);
    } else if (kind) {
      parts.push(summariseBlock(kind));
    }
  }
  return parts.join('\n').trim();
}

/** Codex rollout parser (`~/.codex/sessions/<date>/rollout-*.jsonl`). */
export function parseCodexBatch(input: HistoryParseInput): HistoryParseBatch {
  const problems: HistoryProblem[] = [];
  const records: { lineNumber: number; record: Record<string, unknown> }[] = [];
  for (const line of input.lines) {
    try {
      const parsed: unknown = JSON.parse(line.text);
      if (!isRecord(parsed)) {
        problems.push(problem(input, 'invalid_structure', 'line is not a JSON object', line.lineNumber));
      } else {
        records.push({ lineNumber: line.lineNumber, record: parsed });
      }
    } catch (error) {
      problems.push(problem(input, 'json_parse', String(error instanceof Error ? error.message : error), line.lineNumber));
    }
  }

  const patch: HistorySessionPatch = {};
  let nativeId = input.nativeIdHint;
  for (const { record } of records) {
    if (readString(record.type) !== 'session_meta' || !isRecord(record.payload)) continue;
    nativeId = readString(record.payload.id) ?? readString(record.payload.session_id) ?? nativeId;
    patch.nativeId = nativeId;
    patch.cwd = readString(record.payload.cwd) ?? patch.cwd;
    patch.model = readString(record.payload.model) ?? readString(record.payload.model_provider) ?? patch.model;
    break;
  }
  if (!nativeId) {
    problems.push(problem(input, 'missing_identity', 'no Codex session id in this transcript; refusing to invent one from cwd, title or filename'));
    return { patch, messages: [], problems };
  }
  patch.nativeId = nativeId;

  const sessionId = historySessionId('codex', nativeId);
  const messages: HistoryMessage[] = [];
  let seq = input.startSeq;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  for (const { record, lineNumber } of records) {
    const at = readString(record.timestamp);
    if (at) {
      firstAt ??= at;
      lastAt = at;
    }
    if (!isRecord(record.payload)) continue;
    const topType = readString(record.type);
    const payload = record.payload;
    if (topType === 'compacted' || (topType === 'event_msg' && readString(payload.type) === 'context_compacted')) {
      patch.compacted = true;
      continue;
    }
    if (topType === 'turn_context') {
      patch.cwd = readString(payload.cwd) ?? patch.cwd;
      patch.model = readString(payload.model) ?? patch.model;
      continue;
    }
    if (topType !== 'response_item') continue;

    const itemType = readString(payload.type);
    let role: HistoryRole;
    let text = '';
    if (itemType === 'message') {
      role = mapRole(readString(payload.role), 'unknown');
      text = payloadText(payload);
      if (!Array.isArray(payload.content)) {
        problems.push(problem(input, 'invalid_structure', 'Codex message record has no content array', lineNumber));
        continue;
      }
    } else if (itemType === 'function_call' || itemType === 'custom_tool_call') {
      role = 'tool';
      text = summariseBlock('tool', readString(payload.name));
    } else {
      continue;
    }
    if (!text) continue;
    const bounded = boundText(text);
    messages.push({
      id: historyMessageId(sessionId, input.fileKey, seq),
      sessionId,
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
