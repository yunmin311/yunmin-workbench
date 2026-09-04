import type { ProjectionDiagnosticV0 } from './types';

/**
 * ADAPT / PORT WITH ATTRIBUTION from Archify
 * `archify/renderers/shared/diagnostics.mjs` at commit
 * 06dd052602dd9a369e4d034e24faef0917b5a60c (MIT).
 *
 * Only the pure plain-object and diagnostic normalization/dedup ideas are
 * ported. Archify's environment flag, process-global recorder, fs writes,
 * global symbol, suppression depth, and uncaught-exception boundary are
 * deliberately not present: Workbench's projection core stays pure.
 */

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined),
  );
}

function field(input: unknown, name: string): unknown {
  return input && typeof input === 'object'
    ? (input as Record<string, unknown>)[name]
    : undefined;
}

export function normalizeProjectionDiagnostic(input: unknown): ProjectionDiagnosticV0 {
  const rawFixes = field(input, 'supportedFixes');
  const rawMessage = String(field(input, 'message') || 'Workbench could not classify this projection failure.').trim();
  return {
    code: String(field(input, 'code') || 'internal/unclassified').trim(),
    severity: field(input, 'severity') === 'warning' ? 'warning' : 'error',
    message: rawMessage || 'Workbench could not classify this projection failure.',
    subject: plainObject(field(input, 'subject')),
    evidence: plainObject(field(input, 'evidence')),
    supportedFixes: Array.isArray(rawFixes)
      ? [...new Set(rawFixes.map((fix) => String(fix).trim()).filter(Boolean))]
      : [],
  };
}

/** Deduplication is call-local; Projection has no process-global recorder. */
export function normalizeProjectionDiagnostics(inputs: readonly unknown[]): ProjectionDiagnosticV0[] {
  const messages = new Set<string>();
  const normalized: ProjectionDiagnosticV0[] = [];
  for (const input of inputs) {
    const diagnostic = normalizeProjectionDiagnostic(input);
    if (messages.has(diagnostic.message)) continue;
    messages.add(diagnostic.message);
    normalized.push(diagnostic);
  }
  return normalized;
}

