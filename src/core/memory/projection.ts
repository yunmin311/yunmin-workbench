import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { HistoryMessage, HistorySessionDetail } from '../history/types';
import type { ObservationVerification } from '../types';
import type { EvidenceResult, MemoryEvent, MemoryFact, MemoryProjection } from './types';

const MARKER = /^\[memory (event|fact|correction|conflict)(?:\s+(supersedes|conflicts)="([^"]+)")?\]\s*(.+)$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const digest = (value: string): string => bytesToHex(sha256(new TextEncoder().encode(value)));
const key = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const unique = <T>(values: T[]): T[] => [...new Set(values)];

function weakest(values: ObservationVerification[]): ObservationVerification {
  const order: ObservationVerification[] = ['UNKNOWN', 'INFERRED', 'OBSERVED', 'VERIFIED'];
  return values.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? 'UNKNOWN';
}

function parseList(value: string | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
}

function parseMessage(message: HistoryMessage): Omit<MemoryEvent, 'id' | 'supersedes' | 'conflicts' | 'sourceDigest'> | null {
  const parts = message.text.split('|').map((part) => part.trim());
  const match = MARKER.exec(parts[0]);
  if (!match) return null;
  const fields = new Map(parts.slice(1).map((part) => {
    const at = part.indexOf('=');
    return at > 0 ? [part.slice(0, at).trim().toLocaleLowerCase(), part.slice(at + 1).trim()] : ['', ''];
  }));
  const happened = fields.get('happened');
  const happenedStart = fields.get('happenedstart') ?? (happened && ISO.test(happened) ? happened : undefined);
  const happenedEnd = fields.get('happenedend') ?? (happened && ISO.test(happened) ? happened : undefined);
  const markerKind = match[1].toLocaleLowerCase();
  const relation = match[2]?.toLocaleLowerCase();
  return {
    sourceRefs: [message.observed.sourceRef],
    sourceMessageIds: [message.id],
    sourceSessionIds: [message.sessionId],
    mentionedAt: message.at,
    happenedStart: happenedStart && ISO.test(happenedStart) ? happenedStart : undefined,
    happenedEnd: happenedEnd && ISO.test(happenedEnd) ? happenedEnd : undefined,
    status: message.truncated ? 'INVALID' : 'CURRENT',
    summary: match[4].trim().slice(0, 500),
    participants: parseList(fields.get('participants')),
    tags: parseList(fields.get('tags')),
    verification: message.observed.verification,
    kind: markerKind === 'event' ? 'event' : 'fact',
    relationTarget: relation && match[3] ? `${relation}:${match[3]}` : undefined,
  };
}

export function projectMemory(details: HistorySessionDetail[], previous?: MemoryProjection): MemoryProjection {
  const currentMessages = new Map<string, HistoryMessage>();
  for (const detail of details) for (const message of detail.messages) currentMessages.set(message.id, message);

  const current: MemoryEvent[] = [];
  for (const message of currentMessages.values()) {
    const parsed = parseMessage(message);
    if (!parsed?.summary) continue;
    const sourceDigest = digest(`${message.id}\0${message.text}\0${message.observed.sourceRef}`);
    current.push({ ...parsed, sourceDigest, id: `memory-event:${sourceDigest}`, supersedes: [], conflicts: [] });
  }

  const retained = (previous?.events ?? []).filter((prior) => !current.some((item) => item.id === prior.id)).map((prior) => {
    const sourceMessage = prior.sourceMessageIds.map((id) => currentMessages.get(id)).find(Boolean);
    return { ...prior, status: sourceMessage ? 'STALE' as const : 'INVALID' as const };
  });
  const events = [...current, ...retained];

  const factGroups = new Map<string, MemoryEvent[]>();
  for (const event of events.filter((item) => item.kind === 'fact')) {
    const group = factGroups.get(key(event.summary)) ?? [];
    group.push(event);
    factGroups.set(key(event.summary), group);
  }
  const facts: MemoryFact[] = [...factGroups.entries()].map(([statementKey, sourceEvents]) => {
    const currentness = sourceEvents.some((item) => item.status === 'CURRENT')
      ? 'CURRENT' : sourceEvents.some((item) => item.status === 'STALE') ? 'STALE' : 'INVALID';
    return {
      id: `memory-fact:${digest(statementKey)}`,
      statement: sourceEvents.find((item) => item.status === 'CURRENT')?.summary ?? sourceEvents[0].summary,
      sourceEventIds: sourceEvents.map((item) => item.id),
      sourceRefs: unique(sourceEvents.flatMap((item) => item.sourceRefs)),
      status: 'ACTIVE', currentness, verification: weakest(sourceEvents.map((item) => item.verification)),
      supersedes: [], conflicts: [],
    };
  });
  const factByStatement = new Map(facts.map((fact) => [key(fact.statement), fact]));
  for (const event of events.filter((item) => item.status === 'CURRENT')) {
    if (!event.relationTarget) continue;
    const separator = event.relationTarget.indexOf(':');
    const relation = event.relationTarget.slice(0, separator);
    const target = factByStatement.get(key(event.relationTarget.slice(separator + 1)));
    const owner = factByStatement.get(key(event.summary));
    if (!target || !owner || target.id === owner.id) continue;
    if (relation === 'supersedes') {
      owner.supersedes.push(target.id);
      if (target.currentness === 'CURRENT') target.status = 'SUPERSEDED';
      event.supersedes.push(...target.sourceEventIds);
    } else {
      owner.conflicts.push(target.id);
      target.conflicts.push(owner.id);
      if (target.currentness === 'CURRENT') owner.status = target.status = 'CONFLICTING';
      event.conflicts.push(...target.sourceEventIds);
      for (const targetEvent of events.filter((item) => target.sourceEventIds.includes(item.id))) targetEvent.conflicts.push(event.id);
    }
  }
  for (const fact of facts) {
    fact.supersedes = unique(fact.supersedes);
    fact.conflicts = unique(fact.conflicts);
  }
  for (const event of events) {
    event.supersedes = unique(event.supersedes);
    event.conflicts = unique(event.conflicts);
  }
  return { schemaVersion: 1, events, facts };
}

export function assessMemoryEvidence(
  record: Pick<MemoryFact, 'sourceRefs' | 'currentness'> & Partial<Pick<MemoryFact, 'status'>>,
  suppliedRefs: string[],
): EvidenceResult {
  const bound = 50;
  const evidenceRefs = unique(suppliedRefs).slice(0, 50);
  if (record.sourceRefs.length > bound || unique(suppliedRefs).length > bound) {
    return { verdict: 'PARTIAL', evidenceRefs, missing: [`evidence set exceeds the ${bound}-reference gate`], nextStrategy: 'SEARCH_AGAIN' };
  }
  const unrelated = evidenceRefs.filter((item) => !record.sourceRefs.includes(item));
  if (unrelated.length > 0) return { verdict: 'WRONG', evidenceRefs, missing: record.sourceRefs.slice(0, bound), nextStrategy: 'SEARCH_AGAIN' };
  const missing = record.sourceRefs.filter((item) => !evidenceRefs.includes(item)).slice(0, bound);
  if (record.status === 'SUPERSEDED') return { verdict: 'WRONG', evidenceRefs, missing, nextStrategy: 'SEARCH_AGAIN' };
  if (record.status === 'CONFLICTING') return { verdict: 'PARTIAL', evidenceRefs, missing, nextStrategy: 'EXPAND_SOURCE' };
  if (record.currentness !== 'CURRENT') return { verdict: 'PARTIAL', evidenceRefs, missing, nextStrategy: 'REFRESH_SOURCE' };
  if (missing.length > 0) return { verdict: 'PARTIAL', evidenceRefs, missing, nextStrategy: 'EXPAND_SOURCE' };
  return { verdict: 'SUFFICIENT', evidenceRefs, missing: [], nextStrategy: 'NONE' };
}
