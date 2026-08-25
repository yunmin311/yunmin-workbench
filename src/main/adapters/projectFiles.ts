import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { projectFileSourceRef } from '../../core/project/sourceIdentity';
import type { ContextItem, SourceFingerprint } from '../../core/types';

export const MAX_FILE_CONTEXT_BYTES = 256 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function escapesRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel);
}

export interface ResolvedProjectFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

/**
 * Resolve one explicit file without guessing. Both lexical and real paths must
 * stay inside the machine-bound project root, so traversal and symlink escape
 * fail closed.
 */
export async function resolveProjectFile(projectRoot: string, requestedPath: string): Promise<ResolvedProjectFile> {
  if (!requestedPath || requestedPath.includes('\0') || isAbsolute(requestedPath) || win32.isAbsolute(requestedPath)) {
    throw new Error('project file path must be relative to the project root');
  }
  const rootReal = await realpath(projectRoot);
  const lexical = resolve(rootReal, requestedPath);
  if (escapesRoot(rootReal, lexical)) throw new Error('project file escapes the project root');

  const fileReal = await realpath(lexical);
  if (escapesRoot(rootReal, fileReal)) throw new Error('project file resolves outside the project root');
  const info = await stat(fileReal);
  if (!info.isFile()) throw new Error('project file is not a regular file');
  return {
    absolutePath: fileReal,
    relativePath: relative(rootReal, fileReal).replace(/\\/g, '/'),
    size: info.size,
  };
}

export async function fingerprintProjectFile(
  projectId: string,
  projectRoot: string,
  requestedPath: string,
): Promise<SourceFingerprint> {
  const resolved = await resolveProjectFile(projectRoot, requestedPath);
  return {
    sourceRef: projectFileSourceRef(projectId, resolved.relativePath),
    sha256: await sha256File(resolved.absolutePath),
  };
}

/** Fingerprint an explicitly named file under any trusted bound root. */
export async function fingerprintFileAtRoot(
  root: string,
  requestedPath: string,
  sourceRef: string,
): Promise<SourceFingerprint> {
  const resolved = await resolveProjectFile(root, requestedPath);
  return { sourceRef, sha256: await sha256File(resolved.absolutePath) };
}

export async function createProjectFileContext(
  projectId: string,
  projectRoot: string,
  requestedPath: string,
  asReference: boolean,
): Promise<{ item: ContextItem; fingerprint: SourceFingerprint }> {
  const resolved = await resolveProjectFile(projectRoot, requestedPath);
  if (!asReference && resolved.size > MAX_FILE_CONTEXT_BYTES) {
    throw new Error(
      `file is ${resolved.size} bytes; Context limit is ${MAX_FILE_CONTEXT_BYTES} bytes (use Reference instead)`,
    );
  }
  const bytes = asReference ? null : await readFile(resolved.absolutePath);
  if (bytes && bytes.byteLength > MAX_FILE_CONTEXT_BYTES) {
    throw new Error(
      `file is ${bytes.byteLength} bytes; Context limit is ${MAX_FILE_CONTEXT_BYTES} bytes (use Reference instead)`,
    );
  }
  const fingerprint: SourceFingerprint = {
    sourceRef: projectFileSourceRef(projectId, resolved.relativePath),
    sha256: bytes ? sha256(bytes) : await sha256File(resolved.absolutePath),
  };
  let body: string;
  if (asReference) {
    body = `locator: ${fingerprint.sourceRef}\nbytes: ${resolved.size}\nsha256: ${fingerprint.sha256}`;
  } else {
    try {
      body = new TextDecoder('utf-8', { fatal: true }).decode(bytes!);
    } catch {
      throw new Error('file is not valid UTF-8 text (use Reference instead)');
    }
  }
  return {
    item: {
      id: `project-file:${projectId}:${resolved.relativePath}:${asReference ? 'reference' : 'context'}`,
      title: resolved.relativePath,
      source: `project-file:${projectId}`,
      body,
      state: 'included',
      pinned: false,
      isReference: asReference,
      sourceRef: fingerprint.sourceRef,
      provenance: 'EXTERNAL',
      relativePath: resolved.relativePath,
    },
    fingerprint,
  };
}
