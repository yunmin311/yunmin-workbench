import { describe, expect, it } from 'vitest';
import { parseClaudeCodeBatch } from '../../src/core/history/claudeCode';
import { parseCodexBatch } from '../../src/core/history/codex';

const observedAt = '2026-08-30T12:00:00.000Z';

describe('history parser adapters', () => {
  it('parses Claude Code messages with native identity and isolates a malformed line', () => {
    const result = parseClaudeCodeBatch({
      fileKey: 'claude-code::project/session.jsonl',
      sourceRef: 'history:claude-code:project/session.jsonl',
      startSeq: 0,
      observedAt,
      lines: [
        { lineNumber: 1, text: JSON.stringify({ type: 'user', sessionId: 'claude-native', cwd: 'E:\\repo', timestamp: '2026-08-30T10:00:00Z', message: { role: 'user', content: 'find the blue note' } }) },
        { lineNumber: 2, text: '{broken' },
        { lineNumber: 3, text: JSON.stringify({ type: 'assistant', sessionId: 'claude-native', timestamp: '2026-08-30T10:01:00Z', message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'blue note found' }, { type: 'tool_use', name: 'Read' }, { type: 'tool_result', content: 'must not be indexed' }] } }) },
      ],
    });

    expect(result.patch).toMatchObject({ nativeId: 'claude-native', cwd: 'E:\\repo', model: 'claude-test' });
    expect(result.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'find the blue note'],
      ['assistant', 'blue note found\n[tool: Read]'],
    ]);
    expect(result.messages[0].observed).toEqual({
      source: 'canonical-file',
      sourceRef: 'history:claude-code:project/session.jsonl',
      observedAt,
      verification: 'OBSERVED',
    });
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'json_parse', lineNumber: 2 })]);
  });

  it('continues a Claude incremental batch using only the known native id', () => {
    const result = parseClaudeCodeBatch({
      fileKey: 'claude-code::project/session.jsonl',
      sourceRef: 'history:claude-code:project/session.jsonl',
      nativeIdHint: 'claude-native',
      startSeq: 1,
      observedAt,
      lines: [{ lineNumber: 9, text: JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'appended' } }) }],
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ sessionId: 'claude-code::claude-native', seq: 1, text: 'appended' }),
    ]);
    expect(result.problems).toEqual([]);
  });

  it('refuses to invent Claude identity from cwd, title, or filename', () => {
    const result = parseClaudeCodeBatch({
      fileKey: 'claude-code::project/fake-name.jsonl',
      sourceRef: 'history:claude-code:project/fake-name.jsonl',
      startSeq: 0,
      observedAt,
      lines: [{ lineNumber: 1, text: JSON.stringify({ type: 'user', cwd: 'E:\\repo', message: { content: 'hello' } }) }],
    });
    expect(result.messages).toEqual([]);
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'missing_identity' })]);
  });

  it('marks explicit Claude summary compaction without inferring it elsewhere', () => {
    const result = parseClaudeCodeBatch({
      fileKey: 'claude-code::project/compact.jsonl', sourceRef: 'history:claude-code:project/compact.jsonl', startSeq: 0, observedAt,
      lines: [
        { lineNumber: 1, text: JSON.stringify({ type: 'summary', sessionId: 'claude-compact', summary: 'explicit compaction' }) },
        { lineNumber: 2, text: JSON.stringify({ type: 'user', sessionId: 'claude-compact', message: { role: 'user', content: 'after compact' } }) },
      ],
    });
    expect(result.patch.compacted).toBe(true);
  });

  it('parses Codex session metadata and user, assistant, developer, and tool records', () => {
    const result = parseCodexBatch({
      fileKey: 'codex::sessions/rollout.jsonl',
      sourceRef: 'history:codex:sessions/rollout.jsonl',
      startSeq: 0,
      observedAt,
      lines: [
        { lineNumber: 1, text: JSON.stringify({ timestamp: '2026-08-30T09:00:00Z', type: 'session_meta', payload: { id: 'codex-native', cwd: 'E:\\repo', model_provider: 'openai' } }) },
        { lineNumber: 2, text: JSON.stringify({ timestamp: '2026-08-30T09:00:01Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system boundary' }] } }) },
        { lineNumber: 3, text: JSON.stringify({ timestamp: '2026-08-30T09:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'search needle' }] } }) },
        { lineNumber: 4, text: JSON.stringify({ timestamp: '2026-08-30T09:00:03Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'needle found' }] } }) },
        { lineNumber: 5, text: JSON.stringify({ timestamp: '2026-08-30T09:00:04Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', input: '{}' } }) },
        { lineNumber: 6, text: JSON.stringify({ timestamp: '2026-08-30T09:00:05Z', type: 'response_item', payload: { type: 'function_call_output', output: 'private output must not be indexed' } }) },
      ],
    });

    expect(result.patch).toMatchObject({ nativeId: 'codex-native', cwd: 'E:\\repo', model: 'openai' });
    expect(result.messages.map((message) => [message.role, message.text])).toEqual([
      ['system', 'system boundary'],
      ['user', 'search needle'],
      ['assistant', 'needle found'],
      ['tool', '[tool: shell]'],
    ]);
    expect(result.problems).toEqual([]);
  });

  it('reports malformed Codex records without dropping later valid records', () => {
    const result = parseCodexBatch({
      fileKey: 'codex::sessions/rollout.jsonl',
      sourceRef: 'history:codex:sessions/rollout.jsonl',
      nativeIdHint: 'codex-native',
      startSeq: 3,
      observedAt,
      lines: [
        { lineNumber: 8, text: '{partial' },
        { lineNumber: 9, text: JSON.stringify({ timestamp: '2026-08-30T09:01:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'later message' }] } }) },
      ],
    });
    expect(result.messages).toEqual([expect.objectContaining({ seq: 3, text: 'later message' })]);
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'json_parse', lineNumber: 8 })]);
  });

  it('marks only an explicit Codex compaction event', () => {
    const result = parseCodexBatch({
      fileKey: 'codex::sessions/compact.jsonl', sourceRef: 'history:codex:sessions/compact.jsonl', startSeq: 0, observedAt,
      lines: [
        { lineNumber: 1, text: JSON.stringify({ type: 'session_meta', payload: { id: 'codex-compact' } }) },
        { lineNumber: 2, text: JSON.stringify({ type: 'event_msg', payload: { type: 'context_compacted' } }) },
      ],
    });
    expect(result.patch.compacted).toBe(true);
  });
});
