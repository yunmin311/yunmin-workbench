import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { projectRuntimeExecutions } from '../../src/core/project/runtimeInspector';
import { compilePacket, renderAgentInput } from '../../src/core/project/packet';
import type { ActivityEvent, ContextItem } from '../../src/core/types';
import { HistoryService } from '../../src/main/history/historyService';
import { MemoryService } from '../../src/main/memory/memoryService';
import { writeFrozenPacket, listFrozenPackets } from '../../src/main/frozenPacketStore';

const timed = async <T>(operation: () => T | Promise<T>) => {
  const started = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - started };
};

function runtimeEvent(index: number): ActivityEvent {
  const execution = Math.floor(index / 100);
  const nativeRef = `session-${execution}`;
  return {
    id: `event-${index}`,
    projectId: 'scale-project',
    conversationKey: 'scale-project::codex::main',
    harness: 'codex',
    kind: index % 100 === 0 ? 'session-started' : 'tool-completed',
    summary: `event ${index}`,
    runtimeRef: nativeRef,
    runtimeState: index % 100 === 0 ? 'working' : undefined,
    binding: index % 100 === 0
      ? { harness: 'codex', machine: 'scale-machine', externalSessionRef: nativeRef }
      : undefined,
    observed: {
      source: 'protocol', sourceRef: `scale:${index}`,
      observedAt: new Date(Date.UTC(2026, 7, 31) + index).toISOString(), verification: 'OBSERVED',
    },
  };
}

describe('Final hardening scale benchmark', () => {
  it('measures large Runtime projection and large Context/Packet text', async () => {
    const runtime = await timed(() => projectRuntimeExecutions(
      Array.from({ length: 20_000 }, (_, index) => runtimeEvent(index)),
    ));
    expect(runtime.value).toHaveLength(200);

    const body = '0123456789abcdef'.repeat(6_250); // 100 KB
    const staging: ContextItem[] = Array.from({ length: 20 }, (_, index) => ({
      id: `context-${index}`, title: `Context ${index}`, source: `manual:${index}`,
      body, state: 'included', pinned: false, isReference: false, provenance: 'USER PROVIDED',
    }));
    const packet = await timed(() => compilePacket({
      projectId: 'scale-project', conversationKey: 'scale-project::codex::main',
      taskSummary: body, governanceRefs: [], staging, fingerprints: [],
      now: '2026-08-31T00:00:00.000Z', packetId: 'scale-packet',
    }));
    const render = await timed(() => renderAgentInput(packet.value));
    expect(render.value.length).toBeGreaterThan(2_000_000);

    console.info('[scale:core]', JSON.stringify({
      runtimeEvents: 20_000, executions: runtime.value.length, runtimeProjectionMs: runtime.ms,
      packetBytes: render.value.length, packetCompileMs: packet.ms, packetRenderMs: render.ms,
    }));
    expect(runtime.ms).toBeLessThan(5_000);
    expect(packet.ms + render.ms).toBeLessThan(2_000);
  });

  it('measures large History/Memory queries and many Frozen Packets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-scale-core-'));
    const historyRoot = join(root, 'history-source');
    for (let session = 0; session < 100; session += 1) {
      const dir = join(historyRoot, '2026', '08', String(1 + (session % 28)).padStart(2, '0'));
      mkdirSync(dir, { recursive: true });
      const lines = [
        { timestamp: '2026-08-31T00:00:00Z', type: 'session_meta', payload: { id: `session-${session}` } },
        ...Array.from({ length: 20 }, (_, message) => ({
          timestamp: new Date(Date.UTC(2026, 7, 31, 0, 0, message)).toISOString(),
          type: 'response_item',
          payload: {
            type: 'message',
            role: message % 2 ? 'assistant' : 'user',
            content: [{
              type: message % 2 ? 'output_text' : 'input_text',
              text: message === 1
                ? `[memory fact] scale marker ${session} message ${message}`
                : `scale marker ${session} message ${message}`,
            }],
          },
        })),
      ];
      writeFileSync(join(dir, `rollout-${session}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    }
    const stateDir = join(root, 'state');
    const history = new HistoryService({ stateDir, roots: [{ harness: 'codex', root: historyRoot }] });
    const cold = await timed(() => history.list());
    const search = await timed(() => history.search({ text: 'marker 42', limit: 50 }));
    const memory = new MemoryService(stateDir, history);
    const memorySearch = await timed(() => memory.search({ text: 'marker 42', limit: 50 }));
    expect(cold.value.stats.sessions).toBe(100);
    expect(search.value.hits.length).toBeGreaterThan(0);
    expect(memorySearch.value.hits.length).toBeGreaterThan(0);

    const packet = compilePacket({
      projectId: 'scale-project', conversationKey: 'scale-project::codex::main',
      taskSummary: 'frozen scale', governanceRefs: [], staging: [], fingerprints: [],
      now: '2026-08-31T00:00:00.000Z', packetId: 'scale-frozen',
    });
    const frozenWrite = await timed(async () => {
      for (let index = 0; index < 100; index += 1) await writeFrozenPacket(stateDir, packet);
    });
    const frozenWarmList = await timed(() => listFrozenPackets(
      stateDir, packet.projectId, packet.conversationKey,
    ));
    expect(frozenWarmList.value.packets).toHaveLength(100);

    console.info('[scale:services]', JSON.stringify({
      historySessions: cold.value.stats.sessions, historyMessages: cold.value.stats.messages,
      historyColdMs: cold.ms, historySearchMs: search.ms, memorySearchMs: memorySearch.ms,
      frozenPackets: 100, frozenWriteMs: frozenWrite.ms, frozenWarmListMs: frozenWarmList.ms,
    }));
    expect(cold.ms).toBeLessThan(10_000);
    expect(search.ms).toBeLessThan(3_000);
    expect(memorySearch.ms).toBeLessThan(10_000);
    expect(frozenWarmList.ms).toBeLessThan(2_000);
  }, 30_000);
});
