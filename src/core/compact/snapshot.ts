import { z } from 'zod';
import type { AttentionItem } from '../types';
import type { WorkGraphRevision } from '../workgraph/revision';

/**
 * Compact / Edge Panel (PHASE 4A) — thin UI projection state and snapshot
 * assembly over the SAME canonical facts the Full Workbench reads.
 *
 * CurrentSelectionV1 is a LOCAL UI bookmark ("what the user is working on
 * right now in the Full Workbench"). It is written only by an explicit
 * Full-Workbench selection. It is NOT Governance, NOT a WorkGraph SOT, NOT
 * a Task/Runtime state, and it can never be minted from recency, cwd, or
 * activity — this module has no such input.
 *
 * buildCompactSnapshot only PROJECTS facts the caller already holds; it
 * never upgrades UNKNOWN and never shows a module without a real fact.
 */

export const CURRENT_SELECTION_SCHEMA_VERSION = 1 as const;

export interface CurrentSelectionV1 {
  schemaVersion: typeof CURRENT_SELECTION_SCHEMA_VERSION;
  projectId: string;
  /** Exact canonical identity from an explicit Full-Workbench selection. */
  workId?: string;
  taskId?: string;
  updatedAt: string;
}

export const CurrentSelectionSchema = z.object({
  schemaVersion: z.literal(CURRENT_SELECTION_SCHEMA_VERSION),
  projectId: z.string().min(1),
  workId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
}).strict();

export function normalizeCurrentSelection(value: unknown): CurrentSelectionV1 | null {
  const parsed = CurrentSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function currentSelectionFromUser(selection: {
  projectId: string;
  workId?: string;
  taskId?: string;
}, now = new Date().toISOString()): CurrentSelectionV1 {
  return {
    schemaVersion: CURRENT_SELECTION_SCHEMA_VERSION,
    projectId: selection.projectId,
    ...(selection.workId !== undefined ? { workId: selection.workId } : {}),
    ...(selection.taskId !== undefined ? { taskId: selection.taskId } : {}),
    updatedAt: now,
  };
}

// ===== Compact snapshot assembly (pure projection) =====

export interface CompactWorkFact {
  workId: string;
  label: string;
  currentness: string;
}

export interface CompactTaskFact {
  taskId: string;
  label: string;
  taskState: string;
}

export interface CompactRunningFact {
  executionId: string;
  harness: string;
  startedAt: string;
}

export interface CompactAttentionFact {
  id: string;
  level: string;
  title: string;
}

export interface CompactSnapshot {
  project: { projectId: string } | null;
  work: CompactWorkFact | null;
  task: CompactTaskFact | null;
  /** Real live executions only; empty when nothing runs. */
  running: CompactRunningFact[];
  /** Real Attention instances only; empty when none. */
  attention: CompactAttentionFact[];
}

export interface CompactFactsInput {
  selection: CurrentSelectionV1 | null;
  /** The verified Work Graph revision for the selected project (same read model as Full). */
  revision: WorkGraphRevision | null;
  /** LiveExecutionRegistry list — real running executions. */
  liveExecutions: { executionId: string; harness: string; startedAt: string }[];
  /**
   * Already-reduced Attention instances (reduceAttention + local state
   * applied). Gate DEFINITIONS never appear here; only real instances do.
   */
  attentionItems: AttentionItem[];
}

export function buildCompactSnapshot(input: CompactFactsInput): CompactSnapshot {
  const selection = input.selection;
  if (!selection) {
    // No explicit selection: nothing may be guessed, not even the project.
    return { project: null, work: null, task: null, running: [], attention: [] };
  }
  const nodes = input.revision?.candidate.semanticFacts.nodes ?? [];
  const rawWorkNode = selection.workId !== undefined
    ? nodes.find((node) => node.kind === 'work' && node.workId === selection.workId)
    : undefined;
  const workNode = rawWorkNode && rawWorkNode.kind === 'work' ? rawWorkNode : undefined;
  const rawTaskNode = selection.taskId !== undefined
    ? nodes.find((node) => node.kind === 'task' && node.taskId === selection.taskId)
    : undefined;
  const taskNode = rawTaskNode && rawTaskNode.kind === 'task' ? rawTaskNode : undefined;
  return {
    project: { projectId: selection.projectId },
    work: workNode
      ? { workId: workNode.workId, label: workNode.label, currentness: workNode.currentness }
      : null,
    task: taskNode
      ? { taskId: taskNode.taskId, label: taskNode.label, taskState: taskNode.taskState }
      : null,
    running: input.liveExecutions.map((execution) => ({
      executionId: execution.executionId,
      harness: execution.harness,
      startedAt: execution.startedAt,
    })),
    // Real Attention instances only; the snapshot preserves their level and
    // never promotes UNKNOWN to a warning.
    attention: input.attentionItems.slice(0, 4).map((item) => ({
      id: item.id,
      level: item.level,
      title: item.title,
    })),
  };
}
