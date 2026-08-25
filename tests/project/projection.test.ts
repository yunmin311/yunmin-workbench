import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDialogueRegistry } from '../../src/core/parse/dialogueRegistry';
import { parseInbox } from '../../src/core/parse/inbox';
import { parseMemoryIndex } from '../../src/core/parse/memoryIndex';
import { parseProjectAdapter } from '../../src/core/parse/projectAdapter';
import { buildControlRoom, listProjects } from '../../src/core/project/controlRoom';
import { buildCanvasGraph } from '../../src/core/project/canvas';
import { buildStaging } from '../../src/core/project/staging';
import type { OverlaySnapshot } from '../../src/core/types';

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures', n), 'utf8');

function snapshot(): OverlaySnapshot {
  return {
    overlayRoot: '/fake',
    foundAt: '2026-08-25T00:00:00Z',
    conversations: parseDialogueRegistry(fx('dialogues.yaml')),
    projects: [parseProjectAdapter(fx('creative-os.adapter.yaml'))!],
    inbox: parseInbox(fx('INBOX.md')),
    memoryIndex: parseMemoryIndex(fx('MEMORY.md')),
    harness: [],
    sourceFingerprints: [],
    problems: [],
  };
}

describe('buildControlRoom', () => {
  const room = buildControlRoom(snapshot(), 'creative-os')!;

  it('buckets conversations by status', () => {
    expect(room.active.map((c) => c.role)).toEqual(['CO Codex 替补']);
    expect(room.waiting.map((c) => c.role)).toEqual(['CO 设计对话']);
    expect(room.blocked).toHaveLength(0);
  });

  it('projects INBOX attention without copying it into a task store', () => {
    expect(room.needsAttention.length).toBeGreaterThan(0);
    expect(room.needsAttention.every((i) => !i.done)).toBe(true);
  });

  it('returns null for a project with neither adapter nor conversations', () => {
    expect(buildControlRoom(snapshot(), 'nope')).toBeNull();
  });
});

describe('listProjects', () => {
  it('unions adapter projects and conversation-claimed projects', () => {
    const list = listProjects(snapshot());
    const ids = list.map((p) => p.projectId);
    expect(ids).toContain('creative-os');
    expect(ids).toContain('governance');
    expect(ids).toContain('personal-site');
    expect(list.find((p) => p.projectId === 'governance')!.trust).toBe('DISCOVERED');
  });
});

describe('buildCanvasGraph', () => {
  const g = buildCanvasGraph(snapshot(), 'creative-os');

  it('creates project + conversation + memory nodes with execution vs data edges', () => {
    expect(g.nodes.some((n) => n.kind === 'project')).toBe(true);
    expect(g.nodes.filter((n) => n.kind === 'conversation')).toHaveLength(2);
    expect(g.nodes.some((n) => n.kind === 'memory')).toBe(true);
    expect(g.edges.filter((e) => e.kind === 'execution')).toHaveLength(2);
    expect(g.edges.filter((e) => e.kind === 'data-context')).toHaveLength(1);
  });

  it('lays out nodes with dagre (positions differ from origin)', () => {
    expect(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(new Set(g.nodes.map((n) => `${n.x},${n.y}`)).size).toBeGreaterThan(1);
  });
});

describe('buildStaging', () => {
  const staging = buildStaging(snapshot(), 'creative-os');

  it('includes gates as included body context', () => {
    const gates = staging.filter((c) => c.source === 'adapter:creative-os');
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.every((c) => c.state === 'included')).toBe(true);
  });

  it('offers memory hooks as available references, not bodies', () => {
    const mem = staging.filter((c) => c.source.startsWith('memory:'));
    expect(mem).toHaveLength(3);
    expect(mem.every((c) => c.isReference && c.state === 'available')).toBe(true);
  });
});
