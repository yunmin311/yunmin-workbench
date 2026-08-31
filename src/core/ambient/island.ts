import { z } from 'zod';
import type { AttentionItem } from '../types';

export interface AmbientIslandPreferenceV1 {
  schemaVersion: 1;
  enabled: boolean;
  expanded: boolean;
  x?: number;
  y?: number;
}

export interface AmbientRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AmbientDisplay {
  id: number;
  workArea: AmbientRectangle;
}

export interface AmbientAttentionSnapshot {
  visible: boolean;
  count: number;
  highestLevel?: AttentionItem['level'];
  items: AttentionItem[];
}

export const DEFAULT_AMBIENT_PREFERENCE: AmbientIslandPreferenceV1 = {
  schemaVersion: 1,
  enabled: false,
  expanded: false,
};

export const AmbientIslandPreferenceSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  expanded: z.boolean(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
}).strict();

export const AmbientAttentionItemSchema = z.object({
  id: z.string().min(1).max(4_096),
  kind: z.enum([
    'approval-required', 'needs-user-input', 'receipt-failed', 'runtime-error',
    'packet-stale', 'packet-invalid', 'gate-attention', 'execution-review',
  ]),
  level: z.enum(['alert', 'action', 'review']),
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(4_000),
  projectId: z.string().min(1).max(1_024).optional(),
  conversationKey: z.string().min(1).max(1_024).optional(),
  sessionRef: z.string().min(1).max(4_096).optional(),
  sourceRef: z.string().min(1, 'Attention provenance is required').max(8_192),
  eventRef: z.string().min(1).max(4_096).optional(),
  observedAt: z.string().datetime(),
  verification: z.enum(['VERIFIED', 'OBSERVED'], {
    message: 'Ambient Island cannot display an unobserved verification level',
  }),
}).strict();

export function normalizeAmbientPreference(value: unknown): AmbientIslandPreferenceV1 {
  const parsed = AmbientIslandPreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_AMBIENT_PREFERENCE };
}

/**
 * Transport guard only. Ordering and attention semantics belong to the existing
 * reducer; the Island preserves them and limits how many rows it renders.
 */
export function ambientAttentionSnapshot(rawItems: AttentionItem[]): AmbientAttentionSnapshot {
  const parsed = rawItems.map((entry) => AmbientAttentionItemSchema.parse(entry) as AttentionItem);
  const seen = new Set<string>();
  const unique: AttentionItem[] = [];
  for (const entry of parsed) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      unique.push(entry);
    }
  }
  if (unique.length === 0) return { visible: false, count: 0, items: [] };
  return {
    visible: true,
    count: unique.length,
    highestLevel: unique[0].level,
    items: unique.slice(0, 4),
  };
}

export function selectAmbientWorkArea(
  point: { x: number; y: number } | undefined,
  displays: AmbientDisplay[],
  primaryDisplayId: number,
): AmbientRectangle {
  if (displays.length === 0) throw new Error('Ambient Island requires a display work area');
  if (point) {
    const containing = displays.find(({ workArea }) =>
      point.x >= workArea.x && point.x < workArea.x + workArea.width
      && point.y >= workArea.y && point.y < workArea.y + workArea.height);
    if (containing) return containing.workArea;
  }
  return displays.find((display) => display.id === primaryDisplayId)?.workArea ?? displays[0].workArea;
}

export function clampAmbientBounds(bounds: AmbientRectangle, workArea: AmbientRectangle): AmbientRectangle {
  const width = Math.min(Math.max(bounds.width, 260), workArea.width);
  const height = Math.min(Math.max(bounds.height, 48), workArea.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

export interface IslandTarget {
  projectId?: string;
  conversationKey?: string;
  sessionRef?: string;
  sourceRef: string;
  eventRef?: string;
}

export interface OverlayLikeSnapshot {
  projects: { projectId: string }[];
  conversations: { key: string; project: string }[];
}

export type IslandNavigationResult =
  | { status: 'navigable'; projectId?: string; conversationKey?: string; sessionRef?: string; eventRef?: string; sourceRef: string }
  | { status: 'unavailable'; reason: string; target: IslandTarget };

/**
 * Pure identity resolver for Island → Main Window navigation.
 * Must never guess: if project or conversation is not present verbatim in snapshot, it is unavailable.
 */
export function resolveIslandTarget(
  target: IslandTarget,
  snapshot: OverlayLikeSnapshot | null,
): IslandNavigationResult {
  if (!snapshot) return { status: 'unavailable', reason: 'no snapshot', target };
  if (target.projectId) {
    const hasProject = snapshot.projects.some((p) => p.projectId === target.projectId);
    if (!hasProject) return { status: 'unavailable', reason: `project not found: ${target.projectId}`, target };
  }
  if (target.conversationKey) {
    const exact = snapshot.conversations.find((c) =>
      c.key === target.conversationKey && (!target.projectId || c.project === target.projectId));
    if (!exact) return { status: 'unavailable', reason: `conversation not found: ${target.conversationKey}`, target };
    return { status: 'navigable', projectId: exact.project, conversationKey: exact.key, sessionRef: target.sessionRef, eventRef: target.eventRef, sourceRef: target.sourceRef };
  }
  if (target.projectId) {
    return { status: 'navigable', projectId: target.projectId, sessionRef: target.sessionRef, eventRef: target.eventRef, sourceRef: target.sourceRef };
  }
  // No project or conversation identity at all -> unavailable, do not guess from sessionRef/sourceRef alone
  return { status: 'unavailable', reason: 'missing project/conversation identity', target };
}
