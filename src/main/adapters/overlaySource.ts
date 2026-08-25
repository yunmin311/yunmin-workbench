import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  parseDialogueRegistry,
  parseHarnessManifest,
  parseInbox,
  parseMachineProfile,
  parseMemoryIndex,
  parseProjectAdapter,
} from '../../core/parse';
import type { Observation, OverlaySnapshot, SourceFingerprint } from '../../core/types';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function observation(sourceRef: string): Observation {
  // file reads are direct canonical-file observations; not self-declared VERIFIED
  return { source: 'canonical-file', sourceRef, observedAt: new Date().toISOString(), verification: 'OBSERVED' };
}

/**
 * Overlay discovery (governance rule): $GOV_OVERLAY -> siblings containing
 * exactly one overlay.yaml -> else UNKNOWN. Never guess between candidates.
 */
export async function discoverOverlayRoot(driveRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<{ root?: string; candidates: string[] }> {
  if (env.GOV_OVERLAY) return { root: env.GOV_OVERLAY, candidates: [env.GOV_OVERLAY] };
  const candidates: string[] = [];
  try {
    for (const entry of await readdir(driveRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await stat(join(driveRoot, entry.name, 'overlay.yaml'));
        candidates.push(join(driveRoot, entry.name));
      } catch { /* not an overlay */ }
    }
  } catch { /* drive not readable */ }
  return { root: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

async function readYamlFiles(dir: string, suffix: string): Promise<{ file: string; text: string }[]> {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(suffix));
    return Promise.all(
      names.map(async (n) => ({ file: join(dir, n), text: await readFile(join(dir, n), 'utf8') })),
    );
  } catch {
    return [];
  }
}

/** Read-only projection of an existing Personal Overlay. Never writes into it. */
export async function loadOverlay(overlayRoot: string): Promise<OverlaySnapshot> {
  const problems: OverlaySnapshot['problems'] = [];
  const fingerprints: SourceFingerprint[] = [];
  const rel = (abs: string) => relative(overlayRoot, abs).split('\\').join('/');

  const track = (file: string, text: string): Observation => {
    const sourceRef = rel(file);
    fingerprints.push({ sourceRef, sha256: sha256(text) });
    return observation(sourceRef);
  };

  const snapshot: OverlaySnapshot = {
    overlayRoot,
    foundAt: new Date().toISOString(),
    conversations: [],
    projects: [],
    inbox: [],
    memoryIndex: [],
    harness: [],
    sourceFingerprints: fingerprints,
    problems,
  };

  for (const { file, text } of await readYamlFiles(join(overlayRoot, 'profiles/machines/instances'), '-dialogues.yaml')) {
    try {
      snapshot.conversations.push(...parseDialogueRegistry(text, track(file, text)));
    } catch (err) {
      problems.push({ source: rel(file), message: String(err) });
    }
  }
  for (const { file, text } of await readYamlFiles(join(overlayRoot, 'projects/instances'), '.adapter.yaml')) {
    try {
      const adapter = parseProjectAdapter(text, track(file, text));
      if (adapter) snapshot.projects.push(adapter);
      else problems.push({ source: rel(file), message: 'no project_id' });
    } catch (err) {
      problems.push({ source: rel(file), message: String(err) });
    }
  }

  const inboxPath = join(overlayRoot, 'INBOX.md');
  try {
    const text = await readFile(inboxPath, 'utf8');
    snapshot.inbox = parseInbox(text, track(inboxPath, text).sourceRef);
  } catch {
    problems.push({ source: 'INBOX.md', message: 'not found' });
  }

  const memPath = join(overlayRoot, 'memory/MEMORY.md');
  try {
    const text = await readFile(memPath, 'utf8');
    snapshot.memoryIndex = parseMemoryIndex(text, track(memPath, text).sourceRef);
  } catch {
    problems.push({ source: 'memory/MEMORY.md', message: 'not found' });
  }

  // current machine profile = the one whose paths.governance_repo matches this overlay root
  const machineDir = join(overlayRoot, 'profiles/machines/instances');
  for (const { file, text } of await readYamlFiles(machineDir, '.yaml')) {
    if (file.endsWith('-dialogues.yaml') || file.endsWith('-health.yaml')) continue;
    try {
      const machine = parseMachineProfile(text, track(file, text));
      if (!machine) continue;
      const doc = (await import('js-yaml')).load(text) as Record<string, unknown>;
      const repo = (doc.paths as Record<string, unknown> | undefined)?.governance_repo;
      if (repo === overlayRoot) snapshot.machine = machine;
    } catch { /* not a machine profile */ }
  }

  const manifestPath = join(overlayRoot, 'harness/manifest.yaml');
  try {
    const text = await readFile(manifestPath, 'utf8');
    snapshot.harness = parseHarnessManifest(text, track(manifestPath, text));
  } catch {
    problems.push({ source: 'harness/manifest.yaml', message: 'not found' });
  }

  return snapshot;
}

/** Lazy memory body read (P4): available ≠ included; bodies load on demand only. */
export async function readMemoryBody(overlayRoot: string, memoryId: string): Promise<string | null> {
  if (memoryId.includes('..') || memoryId.includes('\\') || /[^a-zA-Z0-9_\-/\u4e00-\u9fff]/.test(memoryId)) {
    return null; // path traversal guard
  }
  try {
    return await readFile(join(overlayRoot, 'memory', `${memoryId}.md`), 'utf8');
  } catch {
    return null;
  }
}
