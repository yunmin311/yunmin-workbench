import type { HistoryMessage, HistoryProblem } from '../history/types';
import type { ObservationVerification } from '../types';

export type MemoryCurrentness = 'CURRENT' | 'STALE' | 'INVALID' | 'UNKNOWN';
export type MemoryFactStatus = 'ACTIVE' | 'SUPERSEDED' | 'CONFLICTING';

export interface MemoryEvent {
  id: string;
  sourceRefs: string[];
  sourceMessageIds: string[];
  sourceSessionIds: string[];
  sourceDigest: string;
  mentionedAt?: string;
  happenedStart?: string;
  happenedEnd?: string;
  status: MemoryCurrentness;
  summary: string;
  participants: string[];
  tags: string[];
  supersedes: string[];
  conflicts: string[];
  verification: ObservationVerification;
  kind: 'event' | 'fact';
  relationTarget?: string;
}

export interface MemoryFact {
  id: string;
  statement: string;
  sourceEventIds: string[];
  sourceRefs: string[];
  status: MemoryFactStatus;
  currentness: MemoryCurrentness;
  verification: ObservationVerification;
  supersedes: string[];
  conflicts: string[];
}

export interface MemoryProjection {
  schemaVersion: 1;
  events: MemoryEvent[];
  facts: MemoryFact[];
}

export interface MemorySearchQuery {
  text: string;
  limit?: number;
  includeInvalid?: boolean;
}

export interface MemorySearchHit {
  id: string;
  recordType: 'event' | 'fact';
  summary: string;
  sourceRefs: string[];
  sourceSessionIds: string[];
  mentionedAt?: string;
  happenedStart?: string;
  happenedEnd?: string;
  currentness: MemoryCurrentness;
  verification: ObservationVerification;
  score: number;
  useCount: number;
}

export interface MemorySearchResult {
  hits: MemorySearchHit[];
  problems: HistoryProblem[];
  emptyReason?: 'empty-query' | 'below-min-length';
}

export interface MemoryEvidenceExpansion {
  record: MemoryEvent | MemoryFact;
  messages: HistoryMessage[];
  missingSourceRefs: string[];
  evidence: EvidenceResult;
}

export interface EvidenceResult {
  verdict: 'SUFFICIENT' | 'PARTIAL' | 'WRONG';
  evidenceRefs: string[];
  missing: string[];
  nextStrategy: 'NONE' | 'EXPAND_SOURCE' | 'REFRESH_SOURCE' | 'SEARCH_AGAIN';
}

export interface MemoryUseStateV1 {
  schemaVersion: 1;
  uses: Record<string, { count: number; lastUsedAt: string }>;
}
