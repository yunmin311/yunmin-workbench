import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, parse, relative } from 'node:path';
import {
  parseDialogueRegistry,
  parseHarnessManifest,
  parseInbox,
  parseMachineProfile,
  parseMemoryIndex,
  parseProjectAdapter,
} from '../../core/parse';
import type { Observation, OverlaySnapshot, SourceFingerprint } from '../../core/types';
import { overlayFileSourceRef } from '../../core/project/sourceIdentity';
import { fingerprintProjectFile } from './projectFiles';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function observation(sourceRef: string): Observation {
  // file reads are direct canonical-file observations; not self-declared VERIFIED
  return { source: 'canonical-file', sourceRef, observedAt: new Date().toISOString(), verification: 'OBSERVED' };
}

/**
 * Explicit user overlay binding. When the operator picks an overlay folder
 * in-app, the choice is persisted here and becomes the second seam (after
 * the GOV_OVERLAY env var, before filesystem scanning). It is an explicit
 * user decision, never a heuristic guess, so it keeps the governance rule.
 */
export interface OverlayRootBindingV1 {
  schemaVersion: 1;
  root: string;
  observedAt: string;
  source: 'user-selection';
}

const OVERLAY_BINDING_FILE = 'overlay-root-binding-v1.json';

export function overlayBindingPath(stateDir: string): string {
  return join(stateDir, OVERLAY_BINDING_FILE);
}

export async function readOverlayRootBinding(stateDir: string): Promise<OverlayRootBindingV1 | null> {
  try {
    const raw = JSON.parse(await readFile(overlayBindingPath(stateDir), 'utf8')) as Partial<OverlayRootBindingV1>;
    if (raw.schemaVersion !== 1 || typeof raw.root !== 'string' || raw.root.length === 0) return null;
    if (raw.source !== 'user-selection') return null;
    return { schemaVersion: 1, root: raw.root, observedAt: String(raw.observedAt ?? ''), source: 'user-selection' };
  } catch {
    return null;
  }
}

export async function writeOverlayRootBinding(stateDir: string, root: string): Promise<OverlayRootBindingV1> {
  const binding: OverlayRootBindingV1 = {
    schemaVersion: 1,
    root,
    observedAt: new Date().toISOString(),
    source: 'user-selection',
  };
  await mkdir(stateDir, { recursive: true });
  await writeFile(overlayBindingPath(stateDir), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  return binding;
}

/**
 * Overlay discovery (governance rule): $GOV_OVERLAY -> an explicit user
 * binding -> scan the search root two levels deep for `overlay.yaml` ->
 * else UNKNOWN. Never guess between candidates: exactly one candidate is
 * required for a discovered root.
 */
export async function discoverOverlayRoot(driveRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<{ root?: string; candidates: string[] }> {
  if (env.GOV_OVERLAY) return { root: env.GOV_OVERLAY, candidates: [env.GOV_OVERLAY] };
  const candidates: string[] = [];
  try {
    for (const entry of await readdir(driveRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const level1 = join(driveRoot, entry.name);
      try {
        await stat(join(level1, 'overlay.yaml'));
        candidates.push(level1);
        continue;
      } catch { /* not an overlay at depth 1 */ }
      // Common install layout keeps the overlay inside a workspace folder
      // (e.g. `<drive>\<projects>\<overlay>\overlay.yaml`). Scan one level
      // deeper, skipping heavy or hidden directories; the exactly-one rule
      // still applies across all candidates.
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      let level2: Dirent[];
      try {
        level2 = await readdir(level1, { withFileTypes: true });
      } catch { /* level 1 dir not readable */ continue; }
      for (const child of level2) {
        if (!child.isDirectory()) continue;
        try {
          await stat(join(level1, child.name, 'overlay.yaml'));
          candidates.push(join(level1, child.name));
        } catch { /* not an overlay */ }
      }
    }
  } catch { /* drive not readable */ }
  return { root: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

/** Configurable discovery seam; defaults to the current filesystem root. */
export function defaultOverlaySearchRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.WB_OVERLAY_SEARCH_ROOT || parse(process.cwd()).root;
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
    const sourceRef = overlayFileSourceRef(rel(file));
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
    } catch (err) {
      problems.push({ source: rel(file), message: String(err) });
    }
  }

  const manifestPath = join(overlayRoot, 'harness/manifest.yaml');
  try {
    const text = await readFile(manifestPath, 'utf8');
    snapshot.harness = parseHarnessManifest(text, track(manifestPath, text));
  } catch {
    problems.push({ source: 'harness/manifest.yaml', message: 'not found' });
  }

  // Project canonical files are external facts resolved only through the
  // current machine's explicit projectRoots binding. Missing/unreadable files
  // simply remain unresolved so Packet validity fails closed.
  for (const project of snapshot.projects) {
    const projectRoot = snapshot.machine?.projectRoots[project.projectId];
    const canonicalPath = project.canonicalSource?.path;
    if (!projectRoot || !canonicalPath) continue;
    try {
      fingerprints.push(await fingerprintProjectFile(project.projectId, projectRoot, canonicalPath));
    } catch {
      // No guessing or similar-file search. Packet dependency remains unresolved.
    }
  }

  return snapshot;
}

/** Canonical overlay files worth watching: deliberately narrow, no scope creep. */
export function watchTargets(overlayRoot: string): string[] {
  return [
    join(overlayRoot, 'INBOX.md'),
    join(overlayRoot, 'memory/MEMORY.md'),
    join(overlayRoot, 'profiles/machines/instances'),
    join(overlayRoot, 'projects/instances'),
    join(overlayRoot, 'harness/manifest.yaml'),
  ];
}

/** Lazy memory body read (P4): available ≠ included; bodies load on demand only. */
export async function readMemoryBody(overlayRoot: string, memoryId: string): Promise<string | null> {
  if (memoryId.includes('..') || memoryId.includes('\\') || /[^a-zA-Z0-9_\-/一-鿿]/.test(memoryId)) {
    return null; // path traversal guard
  }
  try {
    return await readFile(join(overlayRoot, 'memory', `${memoryId}.md`), 'utf8');
  } catch {
    return null;
  }
}
