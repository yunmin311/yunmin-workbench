import { describe, expect, it } from 'vitest';
import { projectConversationStatus } from '../../src/renderer/src/components/WorkspaceSidebar';

const mockRuntimeSessions = [
  { conversationKey: 'proj-a::claude::Main', state: 'idle' as const },
  { conversationKey: 'proj-a::claude::Main', state: 'working' as const },
  { conversationKey: 'proj-a::codex::Standby', state: 'idle' as const },
];

const mockAttentionItems = [
  { conversationKey: 'proj-a::claude::Main', kind: 'approval-required' as const, level: 'action' as const },
  { conversationKey: 'proj-a::codex::Standby', kind: 'needs-user-input' as const, level: 'review' as const },
];

describe('projectConversationStatus projection helper', () => {
  it('returns runtime from latest RuntimeSession when available', () => {
    const proj = projectConversationStatus(
      'proj-a::claude::Main',
      mockRuntimeSessions,
      mockAttentionItems,
      'idle', // runtimeState fallback
      'ACTIVE'
    );
    expect(proj.runtime).toEqual({ label: 'Running', className: 'runtime-working' });
  });

  it('falls back to conversation.runtimeState when no RuntimeSession', () => {
    const proj = projectConversationStatus(
      'proj-a::codex::Standby',
      [], // no runtime sessions
      mockAttentionItems,
      'idle', // runtimeState fallback
      'STANDBY'
    );
    expect(proj.runtime).toEqual({ label: 'Idle', className: 'runtime-idle' });
  });

  it('lifecycle comes from conversation.status only', () => {
    const proj = projectConversationStatus(
      'proj-a::claude::Main',
      mockRuntimeSessions,
      mockAttentionItems,
      'idle',
      'PAUSED'
    );
    expect(proj.lifecycle).toEqual({ label: 'Paused', className: 'lifecycle-paused' });
  });

  it('attention comes from AttentionItems', () => {
    const proj = projectConversationStatus(
      'proj-a::claude::Main',
      mockRuntimeSessions,
      mockAttentionItems,
      'idle',
      'ACTIVE'
    );
    expect(proj.attention).toEqual({ label: 'Needs Approval', className: 'attention-approval' });

    const proj2 = projectConversationStatus(
      'proj-a::codex::Standby',
      mockRuntimeSessions,
      mockAttentionItems,
      'idle',
      'STANDBY'
    );
    expect(proj2.attention).toEqual({ label: 'Needs Input', className: 'attention-input' });

    const proj3 = projectConversationStatus(
      'proj-a::deepseek::Advisor',
      mockRuntimeSessions,
      mockAttentionItems,
      'stopped',
      'PAUSED'
    );
    expect(proj3.attention).toBeNull();
  });

  it('runtime fallback uses conversation.runtimeState values (idle/working/error/stopped), not lifecycle values', () => {
    // Even though status is ACTIVE, runtimeState is idle -> runtime should be idle
    const proj = projectConversationStatus(
      'proj-a::claude::Main',
      [], // no runtime sessions
      [],
      'idle', // runtimeState
      'ACTIVE' // status
    );
    expect(proj.runtime).toEqual({ label: 'Idle', className: 'runtime-idle' });
    expect(proj.lifecycle).toEqual({ label: 'Active', className: 'lifecycle-active' });

    // runtimeState working -> runtime working
    const proj2 = projectConversationStatus(
      'proj-a::claude::Main',
      [],
      [],
      'working',
      'ACTIVE'
    );
    expect(proj2.runtime).toEqual({ label: 'Running', className: 'runtime-working' });
    expect(proj2.lifecycle).toEqual({ label: 'Active', className: 'lifecycle-active' });
  });

  it('lifecycle never maps to runtime classes', () => {
    const proj = projectConversationStatus(
      'proj-a::claude::Main',
      [],
      [],
      'idle',
      'STANDBY'
    );
    // lifecycle STANDBY should not produce runtime-standby
    expect(proj.runtime.className).not.toBe('runtime-standby');
    expect(proj.runtime.className).toBe('runtime-idle');
    expect(proj.lifecycle.className).toBe('lifecycle-standby');
  });
});