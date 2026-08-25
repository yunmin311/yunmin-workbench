import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry } from '../../src/core/parse/dialogueRegistry';

const fixture = readFileSync(join(__dirname, '../fixtures/legacy/dialogues.yaml'), 'utf8');

describe('parseDialogueRegistry', () => {
  const convos = parseDialogueRegistry(fixture);

  it('parses all dialogues', () => {
    expect(convos).toHaveLength(4);
  });

  it('keeps verified session ids', () => {
    const lead = convos.find((c) => c.role === '统领对话')!;
    expect(lead.sessionId).toBe('231ab833');
    expect(lead.verification).toBe('VERIFIED');
    expect(lead.status).toBe('ACTIVE');
  });

  it('treats session_id UNVERIFIED as absent and downgrades verification', () => {
    const sub = convos.find((c) => c.role === 'CO Codex 替补')!;
    expect(sub.sessionId).toBeUndefined();
    expect(sub.verification).toBe('UNVERIFIED');
    expect(sub.status).toBe('STANDBY');
  });

  it('normalizes unknown status values to UNKNOWN (fail-closed, never guess)', () => {
    const weird = convos.find((c) => c.role === '无状态对话')!;
    expect(weird.status).toBe('UNKNOWN');
  });

  it('returns empty array for malformed input', () => {
    expect(parseDialogueRegistry('not: a registry')).toEqual([]);
  });
});
