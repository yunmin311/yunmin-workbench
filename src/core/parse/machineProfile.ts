import { load } from 'js-yaml';
import type { MachineProfile, Observation } from '../types';

const FALLBACK_OBSERVED: Observation = {
  source: 'canonical-file',
  sourceRef: 'unknown',
  observedAt: 'unknown',
  verification: 'UNKNOWN',
};

/**
 * Parse a machine profile instance (schema_version 2). Only fields the
 * Workbench actually projects: identity, tools, project->local root bindings.
 */
export function parseMachineProfile(yamlText: string, observed: Observation = FALLBACK_OBSERVED): MachineProfile | null {
  const doc = load(yamlText) as Record<string, unknown> | null;
  if (!doc || doc.profile_type !== 'machine' || typeof doc.device_id !== 'string') return null;

  const projectRoots: Record<string, string> = {};
  if (Array.isArray(doc.project_roots)) {
    for (const r of doc.project_roots as Record<string, unknown>[]) {
      if (typeof r?.id === 'string' && typeof r?.local_path === 'string') {
        projectRoots[r.id] = r.local_path;
      }
    }
  }
  if (typeof doc.project_bindings === 'object' && doc.project_bindings !== null) {
    for (const [k, v] of Object.entries(doc.project_bindings as Record<string, unknown>)) {
      const root = (v as Record<string, unknown>)?.local_root;
      if (typeof root === 'string') projectRoots[k] = root;
    }
  }

  const availableTools: Record<string, string> = {};
  if (typeof doc.available_tools === 'object' && doc.available_tools !== null) {
    for (const [k, v] of Object.entries(doc.available_tools as Record<string, unknown>)) {
      availableTools[k] = String(v);
    }
  }

  return {
    deviceId: doc.device_id,
    displayName: typeof doc.display_name === 'string' ? doc.display_name : doc.device_id,
    retirementStatus: typeof doc.retirement_status === 'string' ? doc.retirement_status : undefined,
    availableTools,
    projectRoots,
    observed,
  };
}
