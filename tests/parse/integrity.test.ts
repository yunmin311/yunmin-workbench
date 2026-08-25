import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry, toTaskState } from '../../src/core/parse/dialogueRegistry';
import type { Observation } from '../../src/core/types';

const fixture = readFileSync(join(__dirname, '../fixtures/dialogues.yaml'), 'utf8');
const observed: Observation = {
  source: 'canonical-file',
  sourceRef: 'profiles/machines/instances/test-dialogues.yaml',
  observedAt: '2026-08-25T00:00:00Z',
  verification: 'OBSERVED',
};

describe('Observation Contract (Integrity §1)', () => {
  const convos = parseDialogueRegistry(fixture, observed);

  it('every conversation carries provenance', () => {
    for (const c of convos) {
      expect(c.observed.source).toBe('canonical-file');
      expect(c.observed.sourceRef).toContain('test-dialogues.yaml');
      expect(c.observed.observedAt).toBe('2026-08-25T00:00:00Z');
      expect(['VERIFIED', 'OBSERVED', 'INFERRED', 'UNKNOWN']).toContain(c.observed.verification);
    }
  });

  it('registry VERIFIED promotes observation; unverified stays OBSERVED (never equal by default)', () => {
    expect(convos.find((c) => c.role === '统领对话')!.observed.verification).toBe('VERIFIED');
    expect(convos.find((c) => c.role === 'CO Codex 替补')!.observed.verification).toBe('OBSERVED');
  });
});

describe('State Separation (Integrity §3)', () => {
  const convos = parseDialogueRegistry(fixture, observed);

  it('registry status maps to taskState only; runtime/attention never merged', () => {
    expect(toTaskState('ACTIVE')).toBe('active');
    expect(toTaskState('PAUSED')).toBe('waiting');
    expect(toTaskState('FROZEN')).toBe('blocked');
    expect(toTaskState('STANDBY')).toBe('standby');
    expect(toTaskState('UNKNOWN')).toBe('unknown');
    for (const c of convos) {
      expect(c.runtimeState).toBe('unknown'); // no runtime adapter yet
      expect(c.attention).toBe('none'); // attention comes from INBOX projection only
    }
  });
});
