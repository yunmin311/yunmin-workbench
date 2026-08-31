import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve, win32 } from 'node:path';
import { z } from 'zod';
import { WorkbenchDraftSchema } from '../../main/draftPersistence';
import { WorkspaceSessionSchema } from '../../main/workspacePersistence';
import type { WorkbenchDraftV1 } from '../project/draft';
import type { WorkspaceSessionV1 } from '../project/workspaceSession';

export const PROFILE_BUNDLE_SCHEMA_VERSION = 1 as const;
export type BindingImportStatus = 'SAME' | 'REBIND REQUIRED' | 'CONFLICT' | 'UNKNOWN';

const EXCLUDED = [
  'external-runtime', 'git-truth', 'governance', 'frozen-packet-body', 'history-raw',
  'history-index', 'attention-projection', 'attention-local-state', 'activity-log', 'frozen-packets',
  'window-geometry', 'unsupported-client-capabilities', 'secrets', 'node_modules', 'machine-temporary-files',
] as const;

const HistoricalLocatorSchema = z.object({
  kind: z.literal('historical-machine-path'),
  value: z.string().min(1).max(16_384),
  authoritative: z.literal(false),
}).strict();

const BundlePayloadSchema = z.object({
  workspaceSession: WorkspaceSessionSchema.nullable(),
  drafts: z.array(WorkbenchDraftSchema).max(10_000),
  projectBindings: z.array(z.object({
    projectId: z.string().min(1).max(1024),
    locator: HistoricalLocatorSchema,
  }).strict()).max(10_000),
}).strict().superRefine((profile, ctx) => {
  const draftKeys = new Set<string>();
  const bindingKeys = new Set<string>();
  for (const [draftIndex, draft] of profile.drafts.entries()) {
    const draftKey = `${draft.scope.projectId}\0${draft.scope.conversationKey}`;
    if (draftKeys.has(draftKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['drafts', draftIndex], message: 'duplicate draft logical identity' });
    }
    draftKeys.add(draftKey);
    for (const [fileIndex, file] of draft.projectFiles.entries()) {
      const parts = file.relativePath.replace(/\\/g, '/').split('/');
      if (isAbsolute(file.relativePath) || win32.isAbsolute(file.relativePath) || parts.includes('..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['drafts', draftIndex, 'projectFiles', fileIndex, 'relativePath'],
          message: 'project file locator must remain relative and contained',
        });
      }
    }
  }
  for (const [bindingIndex, binding] of profile.projectBindings.entries()) {
    if (bindingKeys.has(binding.projectId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['projectBindings', bindingIndex], message: 'duplicate project binding logical identity' });
    }
    bindingKeys.add(binding.projectId);
  }
});

const BundleSchema = z.object({
  schemaVersion: z.literal(PROFILE_BUNDLE_SCHEMA_VERSION),
  bundleId: z.string().uuid(),
  createdAt: z.string().datetime(),
  producer: z.literal('Yunmin Workbench'),
  manifest: z.object({
    included: z.array(z.string()),
    excluded: z.array(z.string()),
  }).strict(),
  profile: BundlePayloadSchema,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type WorkbenchProfileBundleV1 = z.infer<typeof BundleSchema>;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function profileBundleDigest(bundle: Omit<WorkbenchProfileBundleV1, 'digest'>): string {
  return createHash('sha256').update(stable(bundle), 'utf8').digest('hex');
}

const SENSITIVE_KEY = /(^|[_-])(secret|token|password|api[_-]?key|access[_-]?key|private[_-]?key)($|[_-])/i;
const SENSITIVE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\bglpat-[0-9A-Za-z_-]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bnpm_[A-Za-z0-9_-]{16,}\b|\bpypi-[A-Za-z0-9_-]{16,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+)/i;

function assertNoSecrets(value: unknown, path = 'profile'): void {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) throw new Error(`secret-like value rejected at ${path}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`secret field rejected at ${path}.${key}`);
    assertNoSecrets(item, `${path}.${key}`);
  }
}

export function buildProfileBundle(input: {
  createdAt?: string;
  workspaceSession: WorkspaceSessionV1 | null;
  drafts: WorkbenchDraftV1[];
  projectRoots: Record<string, string>;
}): WorkbenchProfileBundleV1 {
  const profile = BundlePayloadSchema.parse({
    workspaceSession: input.workspaceSession,
    drafts: input.drafts,
    projectBindings: Object.entries(input.projectRoots).sort(([a], [b]) => a.localeCompare(b)).map(([projectId, value]) => ({
      projectId,
      locator: { kind: 'historical-machine-path' as const, value, authoritative: false as const },
    })),
  });
  assertNoSecrets(profile);
  const unsigned = {
    schemaVersion: PROFILE_BUNDLE_SCHEMA_VERSION,
    bundleId: randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    producer: 'Yunmin Workbench' as const,
    manifest: {
      included: ['workspace-session', 'draft-metadata', 'manual-context', 'project-file-locators', 'project-binding-metadata'],
      excluded: [...EXCLUDED],
    },
    profile,
  };
  return BundleSchema.parse({ ...unsigned, digest: profileBundleDigest(unsigned) });
}

export function parseProfileBundle(raw: string): WorkbenchProfileBundleV1 {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('malformed profile bundle'); }
  if ((json as { schemaVersion?: unknown })?.schemaVersion !== PROFILE_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`unsupported profile bundle version: ${String((json as { schemaVersion?: unknown })?.schemaVersion)}`);
  }
  const bundle = BundleSchema.parse(json);
  assertNoSecrets(bundle.profile);
  const { digest, ...unsigned } = bundle;
  if (profileBundleDigest(unsigned) !== digest) throw new Error('profile bundle digest mismatch');
  return bundle;
}

export interface ProfileImportPreview {
  bundleId: string;
  digest: string;
  additions: string[];
  updates: string[];
  bindings: { projectId: string; status: BindingImportStatus; historicalLocator: string }[];
  skipped: string[];
  canImport: boolean;
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLocaleLowerCase() === resolve(b).toLocaleLowerCase();
}

export function previewProfileImport(bundle: WorkbenchProfileBundleV1, current: {
  knownProjectIds: string[];
  currentBindings: Record<string, string>;
  existingLocators: ReadonlySet<string>;
  currentDraftKeys?: ReadonlySet<string>;
  hasWorkspaceSession?: boolean;
}): ProfileImportPreview {
  const known = new Set(current.knownProjectIds);
  const bindings = bundle.profile.projectBindings.map(({ projectId, locator }) => {
    const active = current.currentBindings[projectId];
    let status: BindingImportStatus;
    if (!known.has(projectId)) status = 'UNKNOWN';
    else if (active && samePath(active, locator.value)) status = 'SAME';
    else if (active) status = 'CONFLICT';
    else if (!current.existingLocators.has(locator.value)) status = 'REBIND REQUIRED';
    else status = 'REBIND REQUIRED'; // existence never authorizes an automatic binding
    return { projectId, status, historicalLocator: locator.value };
  }).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const draftKeys = current.currentDraftKeys ?? new Set<string>();
  const incomingDraftKeys = bundle.profile.drafts.map((draft) => `${draft.scope.projectId}\0${draft.scope.conversationKey}`);
  const additions = incomingDraftKeys.filter((key) => !draftKeys.has(key));
  const updates = incomingDraftKeys.filter((key) => draftKeys.has(key));
  if (bundle.profile.workspaceSession) (current.hasWorkspaceSession ? updates : additions).push('workspace-session');
  return {
    bundleId: bundle.bundleId,
    digest: bundle.digest,
    additions,
    updates,
    bindings,
    skipped: [...bundle.manifest.excluded],
    canImport: updates.length === 0 && !bindings.some((item) => item.status === 'CONFLICT'),
  };
}
