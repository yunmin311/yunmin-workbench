import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HistoryService } from '../history/historyService';
import { assessMemoryEvidence, projectMemory } from '../../core/memory/projection';
import type {
  MemoryEvidenceExpansion, MemoryProjection, MemorySearchHit, MemorySearchQuery, MemorySearchResult, MemoryUseStateV1,
} from '../../core/memory/types';

const emptyProjection = (): MemoryProjection => ({ schemaVersion: 1, events: [], facts: [] });
const emptyUse = (): MemoryUseStateV1 => ({ schemaVersion: 1, uses: {} });

function validProjection(value: unknown): value is MemoryProjection {
  const candidate = value as Partial<MemoryProjection> | null;
  return candidate?.schemaVersion === 1 && Array.isArray(candidate.events) && Array.isArray(candidate.facts);
}

function validUse(value: unknown): value is MemoryUseStateV1 {
  const candidate = value as Partial<MemoryUseStateV1> | null;
  return candidate?.schemaVersion === 1 && typeof candidate.uses === 'object' && candidate.uses !== null && !Array.isArray(candidate.uses);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value), 'utf8');
  await rename(temp, path);
}

export class MemoryService {
  private operation: Promise<unknown> = Promise.resolve();
  constructor(private readonly stateDir: string, private readonly history: HistoryService) {}
  private projectionPath(): string { return join(this.stateDir, 'memory', 'projection-v1.json'); }
  private usePath(): string { return join(this.stateDir, 'memory', 'use-v1.json'); }

  private async sync(): Promise<{ projection: MemoryProjection; problems: Awaited<ReturnType<HistoryService['list']>>['problems'] }> {
    const catalog = await this.history.list();
    const details = (await Promise.all(catalog.sessions.map((session) => this.history.detail(session.sessionId))))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const loaded = await readJson<unknown>(this.projectionPath(), emptyProjection());
    const projection = projectMemory(details, validProjection(loaded) ? loaded : undefined);
    await writeAtomic(this.projectionPath(), projection);
    return { projection, problems: catalog.problems };
  }

  async readUseState(): Promise<MemoryUseStateV1> {
    const loaded = await readJson<unknown>(this.usePath(), emptyUse());
    return validUse(loaded) ? loaded : emptyUse();
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult> {
    const raw = query.text.trim().toLocaleLowerCase();
    const emptyReason = raw.length === 0 ? 'empty-query' : raw.length < 2 ? 'below-min-length' : undefined;
    const { projection, problems } = await this.sync();
    if (emptyReason) return { hits: [], problems, emptyReason };
    const tokens = raw.split(/\s+/).filter(Boolean);
    const uses = await this.readUseState();
    const eventHits: MemorySearchHit[] = projection.events
      .filter((event) => event.kind === 'event')
      .map((event) => ({
        id: event.id, recordType: 'event' as const, summary: event.summary, sourceRefs: event.sourceRefs,
        sourceSessionIds: event.sourceSessionIds, mentionedAt: event.mentionedAt, happenedStart: event.happenedStart,
        happenedEnd: event.happenedEnd, currentness: event.status, verification: event.verification,
        score: tokens.reduce((sum, token) => sum + event.summary.toLocaleLowerCase().split(token).length - 1, 0),
        useCount: uses.uses[event.id]?.count ?? 0,
      }));
    const factHits: MemorySearchHit[] = projection.facts.map((fact) => {
      const sourceEvents = projection.events.filter((event) => fact.sourceEventIds.includes(event.id));
      return {
        id: fact.id, recordType: 'fact' as const, summary: fact.statement, sourceRefs: fact.sourceRefs,
        sourceSessionIds: [...new Set(sourceEvents.flatMap((event) => event.sourceSessionIds))],
        mentionedAt: sourceEvents.map((event) => event.mentionedAt).filter(Boolean).sort().at(-1),
        currentness: fact.currentness, verification: fact.verification,
        score: tokens.reduce((sum, token) => sum + fact.statement.toLocaleLowerCase().split(token).length - 1, 0),
        useCount: uses.uses[fact.id]?.count ?? 0,
      };
    });
    const hits = [...eventHits, ...factHits].filter((hit) =>
      tokens.every((token) => hit.summary.toLocaleLowerCase().includes(token)) && (query.includeInvalid || hit.currentness === 'CURRENT'),
    ).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.min(query.limit ?? 50, 100));
    return { hits, problems };
  }

  async expand(id: string): Promise<MemoryEvidenceExpansion | null> {
    const { projection } = await this.sync();
    const event = projection.events.find((item) => item.id === id);
    const fact = projection.facts.find((item) => item.id === id);
    const record = event ?? fact;
    if (!record) return null;
    const eventIds = event ? [event.id] : fact!.sourceEventIds;
    const sourceEvents = projection.events.filter((item) => eventIds.includes(item.id));
    const messages = [];
    for (const sessionId of [...new Set(sourceEvents.flatMap((item) => item.sourceSessionIds))]) {
      const detail = await this.history.detail(sessionId);
      if (!detail) continue;
      const ids = new Set(sourceEvents.flatMap((item) => item.sourceMessageIds));
      messages.push(...detail.messages.filter((message) => ids.has(message.id)));
    }
    const foundRefs = new Set(messages.map((message) => message.observed.sourceRef));
    const missingSourceRefs = record.sourceRefs.filter((ref) => !foundRefs.has(ref));
    const currentness = 'currentness' in record ? record.currentness : record.status;
    return {
      record, messages, missingSourceRefs,
      evidence: assessMemoryEvidence({
        sourceRefs: record.sourceRefs,
        currentness,
        status: 'statement' in record ? record.status : undefined,
      }, [...foundRefs]),
    };
  }

  async recordMemoryUse(id: string): Promise<MemoryUseStateV1> {
    const task = this.operation.then(async () => {
      const state = await this.readUseState();
      const prior = state.uses[id];
      state.uses[id] = { count: (prior?.count ?? 0) + 1, lastUsedAt: new Date().toISOString() };
      await writeAtomic(this.usePath(), state);
      return state;
    });
    this.operation = task.then(() => undefined, () => undefined);
    return task as Promise<MemoryUseStateV1>;
  }
}
