import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { historyFileKey, historySourceRef, normalizeHistoryPath } from '../../core/history/identity';
import type { HistoryFileRef, HistoryHarness, HistoryProblem, HistoryRoot } from '../../core/history/types';

export interface DiscoveredHistoryFile extends HistoryFileRef {
  harness: HistoryHarness;
  sourceRef: string;
}

export interface HistoryDiscoveryResult {
  files: DiscoveredHistoryFile[];
  problems: HistoryProblem[];
}

type ReadDirectory = (directory: string) => Promise<Dirent[]>;
const readDirectory: ReadDirectory = (directory) => readdir(directory, { withFileTypes: true });

export async function walkJsonl(
  root: string,
  onUnreadable: (directory: string, error: unknown) => void,
  read: ReadDirectory = readDirectory,
): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await read(directory);
    } catch (error) {
      onUnreadable(directory, error);
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) found.push(path);
    }
  }
  return found;
}

export async function discoverHistoryFiles(roots: HistoryRoot[]): Promise<HistoryDiscoveryResult> {
  const files: DiscoveredHistoryFile[] = [];
  const problems: HistoryProblem[] = [];
  for (const config of roots) {
    const locations = [config.root, ...(config.extraRoots ?? [])];
    for (let index = 0; index < locations.length; index += 1) {
      const root = locations[index];
      const prefix = index === 0 ? basename(root) : `extra-${index}-${basename(root)}`;
      const paths = await walkJsonl(root, (directory, error) => {
        const suffix = relative(root, directory);
        const relativePath = normalizeHistoryPath(join(prefix, suffix));
        problems.push({
          fileKey: historyFileKey(config.harness, relativePath),
          sourceRef: historySourceRef(config.harness, relativePath),
          kind: 'unreadable',
          message: String(error),
        });
      });
      for (const path of paths) {
        try {
          const info = await stat(path);
          const relativePath = normalizeHistoryPath(join(prefix, relative(root, path)));
          files.push({
            harness: config.harness,
            path,
            relativePath,
            fileKey: historyFileKey(config.harness, relativePath),
            sourceRef: historySourceRef(config.harness, relativePath),
            size: info.size,
            mtimeMs: info.mtimeMs,
          });
        } catch (error) {
          const relativePath = normalizeHistoryPath(join(prefix, relative(root, path)));
          problems.push({
            fileKey: historyFileKey(config.harness, relativePath),
            sourceRef: historySourceRef(config.harness, relativePath),
            kind: 'unreadable',
            message: String(error),
          });
        }
      }
    }
  }
  files.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  return { files, problems };
}
