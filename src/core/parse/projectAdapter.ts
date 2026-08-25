import { load } from 'js-yaml';
import type { Observation, ProjectAdapter, TrustLevel } from '../types';

function trustOf(adapterStatus: unknown, verification: unknown): TrustLevel {
  if (verification === 'VERIFIED') return 'VERIFIED';
  if (typeof adapterStatus === 'string' && adapterStatus.length > 0) return 'REGISTERED';
  return 'DISCOVERED';
}

const FALLBACK_OBSERVED: Observation = {
  source: 'canonical-file',
  sourceRef: 'unknown',
  observedAt: 'unknown',
  verification: 'UNKNOWN',
};

/** Parse one project adapter YAML (schema_version 2) into a Workbench ProjectAdapter. */
export function parseProjectAdapter(yamlText: string, observed: Observation = FALLBACK_OBSERVED): ProjectAdapter | null {
  const doc = load(yamlText) as Record<string, unknown> | null;
  if (!doc || typeof doc.project_id !== 'string') return null;
  const cs = (doc.canonical_source ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(doc.roles)
    ? doc.roles
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .map((r) => ({
          name: String(r.name ?? ''),
          responsibility: String(r.primary_responsibility ?? ''),
        }))
    : [];
  const gates: Record<string, string> = {};
  if (typeof doc.project_gates === 'object' && doc.project_gates !== null) {
    for (const [k, v] of Object.entries(doc.project_gates as Record<string, unknown>)) {
      if (typeof v === 'string') gates[k] = v;
    }
  }
  return {
    projectId: doc.project_id,
    displayName: typeof doc.display_name === 'string' ? doc.display_name : doc.project_id,
    status: String(doc.status ?? 'UNKNOWN'),
    lastVerifiedAt: typeof doc.last_verified_at === 'string' ? doc.last_verified_at : undefined,
    canonicalSource: {
      repository: typeof cs.repository === 'string' ? cs.repository : undefined,
      remote: typeof cs.remote === 'string' ? cs.remote : undefined,
      defaultBranch: typeof cs.default_branch === 'string' ? cs.default_branch : undefined,
      path: typeof cs.path === 'string' ? cs.path : undefined,
      commit: typeof cs.commit === 'string' ? cs.commit : undefined,
      verification: typeof cs.verification === 'string' ? cs.verification : undefined,
    },
    roles,
    gates,
    trust: trustOf(doc.status, cs.verification),
    observed: {
      ...observed,
      verification: cs.verification === 'VERIFIED' ? 'VERIFIED' : observed.verification,
    },
  };
}
