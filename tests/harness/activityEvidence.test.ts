import { describe, expect, it } from 'vitest';
import { codexAgentContent, eventEvidence, packetTaskSummary, protocolText } from '../../src/main/activityEvidence';

describe('real result and evidence extraction', () => {
  it('extracts assistant text from Codex agentMessage protocol content', () => {
    expect(codexAgentContent({
      type: 'agentMessage', content: [{ type: 'output_text', text: 'first' }, { type: 'output_text', text: 'second' }],
    })).toBe('first\nsecond');
    expect(codexAgentContent({ type: 'agentMessage', text: 'direct text' })).toBe('direct text');
  });

  it('keeps Claude assistant text and real tool/file evidence details', () => {
    expect(protocolText({ type: 'assistant', text: 'Claude answer' })).toBe('Claude answer');
    expect(eventEvidence({ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'src/App.tsx' } })).toEqual({
      content: 'Edit · src/App.tsx', evidenceRef: 'tool:tool-1',
    });
    expect(eventEvidence({ type: 'fileChange', id: 'change-1', path: 'src/App.tsx' })).toEqual({
      content: 'src/App.tsx', evidenceRef: 'file:change-1',
    });
  });

  it('extracts the real user task from compiled Packet text for the transcript', () => {
    expect(packetTaskSummary('# Governance\n- none\n\n# Task Summary\nShip the actual flow\n\n# Context\n(none)')).toBe('Ship the actual flow');
    expect(packetTaskSummary('not a compiled packet')).toBeUndefined();
  });
});
