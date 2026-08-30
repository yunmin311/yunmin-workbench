import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeCodeBatch } from '../../core/history/claudeCode';
import { parseCodexBatch } from '../../core/history/codex';
import { historySessionId } from '../../core/history/identity';
import type {
  HistoryCatalogResult,
  HistoryFileState,
  HistoryHarness,
  HistoryMessage,
  HistoryProblem,
  HistoryQuery,
  HistoryRoot,
  HistorySearchResult,
  HistorySession,
  HistorySessionDetail,
  HistorySessionPatch,
} from '../../core/history/types';
import { SNIPPET_MARK } from '../../core/history/types';
import { discoverHistoryFiles, type DiscoveredHistoryFile } from './discovery';
import { readHistoryIndex, writeHistoryIndex, type HistoryIndexV1, type StoredHistoryFile } from './indexStore';
import { readJsonlFromOffset } from './jsonlFile';

const MIN_QUERY = 2;

export interface HistoryServiceOptions {
  stateDir: string;
  roots: HistoryRoot[];
}

export function defaultHistoryRoots(home = homedir()): HistoryRoot[] {
  const claude = process.env.WB_CLAUDE_HISTORY_ROOT ?? join(home, '.claude', 'projects');
  const codex = process.env.WB_CODEX_HISTORY_ROOT ?? join(home, '.codex', 'sessions');
  const archived = process.env.WB_CODEX_ARCHIVED_HISTORY_ROOT ?? join(home, '.codex', 'archived_sessions');
  return [
    { harness: 'claude-code', root: claude },
    { harness: 'codex', root: codex, extraRoots: [archived] },
  ];
}

async function hashFile(path: string, compareBytes?: number): Promise<{ contentHash: string; comparedHash?: string }> {
  const full = createHash('sha256');
  const compared = compareBytes === undefined ? null : createHash('sha256');
  let comparedCount = 0;
  for await (const raw of createReadStream(path)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    full.update(chunk);
    if (compared && comparedCount < compareBytes!) {
      const length = Math.min(chunk.length, compareBytes! - comparedCount);
      compared.update(chunk.subarray(0, length));
      comparedCount += length;
    }
  }
  return { contentHash: full.digest('hex'), comparedHash: compared?.digest('hex') };
}

function mergePatch(base: HistorySessionPatch, next: HistorySessionPatch): HistorySessionPatch {
  const merged = { ...base, ...next };
  if (base.startedAt && next.startedAt) merged.startedAt = base.startedAt < next.startedAt ? base.startedAt : next.startedAt;
  if (base.endedAt && next.endedAt) merged.endedAt = base.endedAt > next.endedAt ? base.endedAt : next.endedAt;
  return merged;
}

function aggregate(index: HistoryIndexV1): { sessions: HistorySession[]; messages: Map<string, HistoryMessage[]>; problems: HistoryProblem[] } {
  const sessions = new Map<string, HistorySession>();
  const messages = new Map<string, HistoryMessage[]>();
  const problems: HistoryProblem[] = [];
  for (const entry of Object.values(index.files)) {
    problems.push(...entry.problems);
    const nativeId = entry.patch.nativeId ?? entry.state.sessionId?.split('::').slice(1).join('::');
    if (!nativeId) continue;
    const sessionId = historySessionId(entry.harness, nativeId);
    const prior = sessions.get(sessionId);
    const allMessages = [...(messages.get(sessionId) ?? []), ...entry.messages];
    messages.set(sessionId, allMessages);
    const firstUser = allMessages.find((message) => message.role === 'user')?.text ?? allMessages[0]?.text ?? '';
    const observedAt = entry.state.indexedAt;
    sessions.set(sessionId, {
      sessionId,
      harness: entry.harness,
      nativeId,
      cwd: entry.patch.cwd ?? prior?.cwd,
      title: entry.patch.title ?? prior?.title,
      gitBranch: entry.patch.gitBranch ?? prior?.gitBranch,
      model: entry.patch.model ?? prior?.model,
      startedAt: [prior?.startedAt, entry.patch.startedAt].filter(Boolean).sort()[0],
      endedAt: [prior?.endedAt, entry.patch.endedAt].filter(Boolean).sort().at(-1),
      messageCount: allMessages.length,
      sourceFiles: [...new Set([...(prior?.sourceFiles ?? []), entry.state.fileKey])],
      compacted: Boolean(prior?.compacted || entry.patch.compacted),
      preview: firstUser.slice(0, 240),
      observed: {
        source: 'canonical-file',
        sourceRef: prior?.observed.sourceRef ?? entry.sourceRef,
        observedAt: prior && prior.observed.observedAt > observedAt ? prior.observed.observedAt : observedAt,
        verification: 'OBSERVED',
      },
    });
  }
  for (const list of messages.values()) {
    list.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id));
  }
  return {
    sessions: [...sessions.values()].sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? '')),
    messages,
    problems,
  };
}

function snippet(message: HistoryMessage, token: string): { text: string; clipped: boolean } {
  const lower = message.text.toLocaleLowerCase();
  const index = lower.indexOf(token);
  const start = Math.max(0, index - 120);
  const end = Math.min(message.text.length, index + token.length + 180);
  const body = message.text.slice(start, end);
  const local = index - start;
  return {
    text: `${start > 0 ? '…' : ''}${body.slice(0, local)}${SNIPPET_MARK}${body.slice(local, local + token.length)}${SNIPPET_MARK}${body.slice(local + token.length)}${end < message.text.length ? '…' : ''}`,
    clipped: message.truncated || start > 0 || end < message.text.length,
  };
}

export class HistoryService {
  private syncPromise: Promise<{ index: HistoryIndexV1; stats: HistorySearchResult['stats']; extraProblems: HistoryProblem[] }> | null = null;

  constructor(private readonly options: HistoryServiceOptions) {}

  private async indexFile(file: DiscoveredHistoryFile, previous?: StoredHistoryFile): Promise<StoredHistoryFile> {
    const observedAt = new Date().toISOString();
    // A larger mtime-changed path is append-only only when every byte in the
    // formerly indexed range still matches. Sampling cannot prove replacement
    // safety: a rewrite can preserve both sampled ends and change the middle.
    const hashes = await hashFile(file.path, previous?.state.size);
    const append = Boolean(
      previous && file.size > previous.state.size &&
      previous.state.watermark <= previous.state.size &&
      hashes.comparedHash === previous.contentHash,
    );
    const base = append ? previous : undefined;
    const offset = base?.state.watermark ?? 0;
    const lineCursor = base?.state.lineCursor ?? 0;
    const read = await readJsonlFromOffset(file.path, offset, lineCursor);
    const parser = file.harness === 'claude-code' ? parseClaudeCodeBatch : parseCodexBatch;
    const parsed = parser({
      fileKey: file.fileKey,
      sourceRef: file.sourceRef,
      lines: read.lines,
      nativeIdHint: base?.patch.nativeId,
      startSeq: base?.messages.length ?? 0,
      observedAt,
    });
    const patch = mergePatch(base?.patch ?? {}, parsed.patch);
    const sessionId = patch.nativeId ? historySessionId(file.harness, patch.nativeId) : undefined;
    const state: HistoryFileState = {
      fileKey: file.fileKey,
      path: file.path,
      relativePath: file.relativePath,
      size: file.size,
      mtimeMs: file.mtimeMs,
      watermark: read.newOffset,
      lineCursor: read.newLineCursor,
      sessionId,
      indexedAt: observedAt,
    };
    const problems = [...(base?.problems.filter((item) => item.kind !== 'truncated_source' && !(item.kind === 'missing_identity' && parsed.patch.nativeId)) ?? []), ...parsed.problems];
    if (read.partialTailBytes > 0) {
      problems.push({
        fileKey: file.fileKey,
        sourceRef: file.sourceRef,
        kind: 'truncated_source',
        message: `${read.partialTailBytes} trailing byte(s) are incomplete and were left for the next incremental pass`,
        lineNumber: read.newLineCursor + 1,
      });
    }
    return {
      harness: file.harness,
      sourceRef: file.sourceRef,
      state,
      contentHash: hashes.contentHash,
      patch,
      messages: [...(base?.messages ?? []), ...parsed.messages],
      problems,
    };
  }

  private sync(): Promise<{ index: HistoryIndexV1; stats: HistorySearchResult['stats']; extraProblems: HistoryProblem[] }> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      const loaded = await readHistoryIndex(this.options.stateDir);
      const index = loaded.index;
      const discovery = await discoverHistoryFiles(this.options.roots);
      const present = new Set(discovery.files.map((file) => file.fileKey));
      for (const key of Object.keys(index.files)) if (!present.has(key)) delete index.files[key];
      let filesSkipped = 0;
      let filesIndexed = 0;
      const extraProblems = [...discovery.problems, ...(loaded.problem ? [loaded.problem] : [])];
      for (const file of discovery.files) {
        const previous = index.files[file.fileKey];
        if (previous && previous.state.size === file.size && previous.state.mtimeMs === file.mtimeMs) {
          filesSkipped += 1;
          continue;
        }
        try {
          index.files[file.fileKey] = await this.indexFile(file, previous);
          filesIndexed += 1;
        } catch (error) {
          delete index.files[file.fileKey];
          extraProblems.push({ fileKey: file.fileKey, sourceRef: file.sourceRef, kind: 'unreadable', message: String(error) });
        }
      }
      await writeHistoryIndex(this.options.stateDir, index);
      const view = aggregate(index);
      return {
        index,
        extraProblems,
        stats: { sessions: view.sessions.length, messages: [...view.messages.values()].reduce((sum, value) => sum + value.length, 0), filesSkipped, filesIndexed },
      };
    })().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async list(): Promise<HistoryCatalogResult> {
    const synced = await this.sync();
    const view = aggregate(synced.index);
    return { sessions: view.sessions, problems: [...synced.extraProblems, ...view.problems], stats: synced.stats };
  }

  async detail(sessionId: string): Promise<HistorySessionDetail | null> {
    const synced = await this.sync();
    const view = aggregate(synced.index);
    const session = view.sessions.find((item) => item.sessionId === sessionId);
    if (!session) return null;
    const fileKeys = new Set(session.sourceFiles);
    return {
      session,
      messages: view.messages.get(sessionId) ?? [],
      problems: [...synced.extraProblems, ...view.problems.filter((item) => fileKeys.has(item.fileKey))],
    };
  }

  async search(query: HistoryQuery): Promise<HistorySearchResult> {
    const synced = await this.sync();
    const view = aggregate(synced.index);
    const raw = query.text.trim().toLocaleLowerCase();
    const emptyReason = raw.length === 0 ? 'empty-query' : raw.length < MIN_QUERY ? 'below-min-length' : undefined;
    if (emptyReason) return { hits: [], emptyReason, problems: [...synced.extraProblems, ...view.problems], stats: synced.stats };
    const tokens = raw.split(/\s+/).filter(Boolean);
    const hits: HistorySearchResult['hits'] = [];
    for (const session of view.sessions) {
      if (query.harness && session.harness !== query.harness) continue;
      if (query.cwdContains && !session.cwd?.toLocaleLowerCase().includes(query.cwdContains.toLocaleLowerCase())) continue;
      const candidateMessages = view.messages.get(session.sessionId) ?? [];
      const searchable = `${session.title ?? ''}\n${session.cwd ?? ''}\n${candidateMessages.map((message) => message.text).join('\n')}`.toLocaleLowerCase();
      if (!tokens.every((token) => searchable.includes(token))) continue;
      const best = candidateMessages.find((message) => tokens.some((token) => message.text.toLocaleLowerCase().includes(token)));
      const firstToken = best && tokens.find((token) => best.text.toLocaleLowerCase().includes(token));
      const metadata = [session.title, session.cwd].filter(Boolean).join(' · ');
      const marked = best && firstToken ? snippet(best, firstToken) : { text: metadata, clipped: false };
      const score = tokens.reduce((total, token) => total + searchable.split(token).length - 1, 0);
      hits.push({ session, snippet: marked.text, snippetTruncated: marked.clipped, score });
    }
    hits.sort((a, b) => b.score - a.score || (b.session.endedAt ?? '').localeCompare(a.session.endedAt ?? ''));
    return { hits: hits.slice(0, Math.min(query.limit ?? 50, 200)), problems: [...synced.extraProblems, ...view.problems], stats: synced.stats };
  }
}
