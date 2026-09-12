import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ActivityEvent, AttentionLocalState, ContextItem, ExecutionEnvironment, FrozenPacket, FrozenPacketSummary, GitFacts, HandoffReceipt, HarnessCapabilities, HarnessDispatchRequest, OverlaySnapshot, SourceFingerprint, TaskPacket } from '../core/types';
import type { WorkbenchDraftV1 } from '../core/project/draft';
import type { CabinetStagingV1 } from '../core/project/cabinetStaging';
import type { WorkspaceSessionV1 } from '../core/project/workspaceSession';
import type { HistoryCatalogResult, HistoryQuery, HistorySearchResult, HistorySessionDetail } from '../core/history/types';
import type { ProfileImportPreview } from '../core/portability/bundle';
import type { ProjectRootBindingsV1 } from '../main/projectRootBindings';
import type { MemoryEvidenceExpansion, MemorySearchQuery, MemorySearchResult, MemoryUseStateV1 } from '../core/memory/types';
import type { DoctorReport } from '../main/doctor';
import type { WorkbenchContract } from './contract';
import type { WorkGraphRevision } from '../core/workgraph/revision';

const api = {
  loadOverlay: (opts?: { refresh?: boolean }): Promise<OverlaySnapshot> =>
    ipcRenderer.invoke('overlay:load', opts),
  chooseOverlay: (): Promise<{ canceled?: boolean; root?: string; observedAt?: string; error?: string }> =>
    ipcRenderer.invoke('overlay:choose'),
  loadOverlayBinding: (): Promise<{ root: string; observedAt: string } | null> =>
    ipcRenderer.invoke('overlay:binding'),
  freezePacket: (packet: TaskPacket): Promise<{ frozen: FrozenPacket; path: string }> =>
    ipcRenderer.invoke('packet:freeze', packet),
  listFrozen: (projectId: string, conversationId: string): Promise<{
    packets: FrozenPacketSummary[];
    problems: { file: string; message: string }[];
  }> => ipcRenderer.invoke('packet:list', projectId, conversationId),
  readFrozenDetail: (
    projectId: string,
    conversationId: string,
    query: { version: number } | { hash: string },
  ): Promise<FrozenPacket | null> =>
    ipcRenderer.invoke('packet:detail', projectId, conversationId, query),
  readMemory: (memoryId: string): Promise<string | null> =>
    ipcRenderer.invoke('memory:read', memoryId),
  loadGit: (projectId: string): Promise<{ facts?: GitFacts; error?: string }> =>
    ipcRenderer.invoke('git:load', projectId),
  chooseProjectFile: (
    projectId: string,
    asReference: boolean,
  ): Promise<{ item?: ContextItem; fingerprint?: SourceFingerprint; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('project-file:choose', { projectId, asReference }),
  refreshProjectFiles: (
    projectId: string,
    files: { relativePath: string; asReference: boolean }[],
  ): Promise<{
    entries: { item: ContextItem; fingerprint: SourceFingerprint }[];
    errors: string[];
  }> => ipcRenderer.invoke('project-file:refresh', { projectId, files }),
  recheckSources: (
    projectId: string,
    sourceRefs: string[],
  ): Promise<{
    checkedSourceRefs: string[];
    fingerprints: SourceFingerprint[];
    errors: { sourceRef: string; message: string }[];
  }> => ipcRenderer.invoke('sources:recheck', { projectId, sourceRefs }),
  loadDraft: (
    projectId: string,
    conversationKey: string,
  ): Promise<{ draft: WorkbenchDraftV1 | null; problem?: string }> =>
    ipcRenderer.invoke('draft:load', { projectId, conversationKey }),
  saveDraft: (draft: WorkbenchDraftV1): Promise<{ path: string }> =>
    ipcRenderer.invoke('draft:save', draft),
  clearDraft: (projectId: string, conversationKey: string): Promise<void> =>
    ipcRenderer.invoke('draft:clear', { projectId, conversationKey }),
  loadCabinetStaging: (
    projectId: string,
  ): Promise<{ staging: CabinetStagingV1 | null; problem?: string; migrated?: boolean }> =>
    ipcRenderer.invoke('cabinet-staging:load', { projectId }),
  saveCabinetStaging: (staging: CabinetStagingV1): Promise<{ path: string }> =>
    ipcRenderer.invoke('cabinet-staging:save', staging),
  getCurrentSelection: (): Promise<unknown> =>
    ipcRenderer.invoke('selection:get'),
  setCurrentSelection: (selection: { projectId: string; workId?: string; taskId?: string }): Promise<void> =>
    ipcRenderer.invoke('selection:set', selection),
  toggleCompactWindow: (): Promise<{ visible: boolean }> =>
    ipcRenderer.invoke('compact:toggle'),
  setCompactExpanded: (expanded: boolean): Promise<{ expanded: boolean }> =>
    ipcRenderer.invoke('compact:set-expanded', { expanded }),
  openWorkbenchFromCompact: (identity: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' }): Promise<{ focused: boolean }> =>
    ipcRenderer.invoke('compact:open-workbench', identity),
  onCompactNavigate: (cb: (identity: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, identity: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' }) => cb(identity);
    ipcRenderer.on('compact:navigate', listener);
    return () => ipcRenderer.removeListener('compact:navigate', listener);
  },
  searchProjectFiles: (
    projectId: string,
    query: string,
  ): Promise<{ matches: string[]; errors: string[] }> =>
    ipcRenderer.invoke('project-file:search', { projectId, query }),
  readPinnedProjectFile: (
    projectId: string,
  ): Promise<{ item?: ContextItem; fingerprint?: SourceFingerprint; error?: string }> =>
    ipcRenderer.invoke('project-file:pinned', { projectId }),
  loadWorkspaceSession: (): Promise<{ session: WorkspaceSessionV1 | null; problem?: string }> =>
    ipcRenderer.invoke('workspace:load'),
  saveWorkspaceSession: (session: WorkspaceSessionV1): Promise<{ path: string }> =>
    ipcRenderer.invoke('workspace:save', session),
  loadHarnessCapabilities: (): Promise<HarnessCapabilities> =>
    ipcRenderer.invoke('harness:capabilities'),
  loadAllHarnessCapabilities: (environment: ExecutionEnvironment = { kind: 'real' }): Promise<Record<string, HarnessCapabilities>> =>
    ipcRenderer.invoke('harness:capabilitiesAll', environment),
  dispatchToHarness: (request: HarnessDispatchRequest): Promise<HandoffReceipt> =>
    ipcRenderer.invoke('harness:dispatch', request),
  smokeHarness: (projectId: string, harness: 'codex' | 'claude' | 'deepseek'): Promise<HandoffReceipt | { userAgent: string; ephemeralThreadId: string }> =>
    ipcRenderer.invoke('harness:smoke', projectId, harness),
  loadLiveExecutions: (): Promise<{ executionId: string; harness: string; externalSessionRef: string; startedAt: string; canCancel: boolean }[]> =>
    ipcRenderer.invoke('runtime:live'),
  cancelExecution: (executionId: string): Promise<{ delivered: boolean; reason?: string }> =>
    ipcRenderer.invoke('harness:cancel', { executionId }),
  loadActivity: (options?: { beforeByte?: number; limit?: number }): Promise<{
    events: ActivityEvent[]; problem?: string; rejectedLines: number; nextBeforeByte?: number; hasEarlier: boolean;
  }> => ipcRenderer.invoke('activity:load', options),
  clearActivity: (): Promise<void> => ipcRenderer.invoke('activity:clear'),
  loadAttentionLocal: (): Promise<AttentionLocalState> => ipcRenderer.invoke('attention:local:load'),
  dismissAttention: (itemId: string, observedAt: string): Promise<void> =>
    ipcRenderer.invoke('attention:dismiss', { itemId, observedAt }),
  listHistory: (): Promise<HistoryCatalogResult> => ipcRenderer.invoke('history:list'),
  searchHistory: (query: HistoryQuery): Promise<HistorySearchResult> => ipcRenderer.invoke('history:search', query),
  readHistoryDetail: (sessionId: string): Promise<HistorySessionDetail | null> => ipcRenderer.invoke('history:detail', sessionId),
  searchMemory: (query: MemorySearchQuery): Promise<MemorySearchResult> => ipcRenderer.invoke('memory:search', query),
  expandMemory: (id: string): Promise<MemoryEvidenceExpansion | null> => ipcRenderer.invoke('memory:expand', id),
  recordMemoryUse: (id: string): Promise<MemoryUseStateV1> => ipcRenderer.invoke('memory:record-use', id),
  previewProfileExport: (): Promise<{ preview: {
    digest: string; drafts: number; manualContexts: number; projectBindings: number; workspaceSession: boolean;
    included: string[]; skipped: string[];
  } }> => ipcRenderer.invoke('portability:export-preview'),
  applyProfileExport: (digest: string): Promise<{ canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke('portability:export-apply', digest),
  loadProjectRootBindings: (): Promise<ProjectRootBindingsV1> => ipcRenderer.invoke('portability:bindings'),
  previewProfileImport: (): Promise<{ canceled?: boolean; preview?: ProfileImportPreview }> =>
    ipcRenderer.invoke('portability:import-preview'),
  applyProfileImport: (digest: string): Promise<{ imported: true }> => ipcRenderer.invoke('portability:import-apply', digest),
  rebindProjectRoot: (projectId: string): Promise<{ canceled?: boolean; binding?: { root: string; verifiedAt: string } }> =>
    ipcRenderer.invoke('portability:rebind', projectId),
  onActivityChanged: (cb: (event: ActivityEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, event: ActivityEvent) => cb(event);
    ipcRenderer.on('activity:changed', listener);
    return () => ipcRenderer.removeListener('activity:changed', listener);
  },
  onActivityCleared: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('activity:cleared', listener);
    return () => ipcRenderer.removeListener('activity:cleared', listener);
  },
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
  onDraftFlushRequest: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('drafts:flush', listener);
    return () => ipcRenderer.removeListener('drafts:flush', listener);
  },
  /**
   * Acknowledge a flush request. The report means the flush *settled*: every
   * pending write either succeeded or recorded its failure in the renderer
   * UI. It is NOT a durability guarantee; the main process proceeds on this
   * acknowledgement or its own deadline, whichever comes first.
   */
  draftsFlushSettled: (result: { attempted: number; failed: number }): void =>
    ipcRenderer.send('drafts:flush-settled', result),
  onOverlayChanged: (cb: () => void): (() => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on('overlay:changed', listener);
    return () => ipcRenderer.removeListener('overlay:changed', listener);
  },
  onAppFocus: (cb: () => void): (() => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on('app:focus', listener);
    return () => ipcRenderer.removeListener('app:focus', listener);
  },
  onIslandSourceSelected: (cb: (target: {
    projectId?: string;
    conversationKey?: string;
    sessionRef?: string;
    sourceRef: string;
    eventRef?: string;
  }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, target: unknown) => cb(target as {
      projectId?: string;
      conversationKey?: string;
      sessionRef?: string;
      sourceRef: string;
      eventRef?: string;
    });
    ipcRenderer.on('island:source-selected', listener);
    return () => ipcRenderer.removeListener('island:source-selected', listener);
  },
  syncIslandAttention: (items: unknown): void =>
    ipcRenderer.send('island:sync-attention', items),
  loadMaterialPreference: (): Promise<{ material: string }> =>
    ipcRenderer.invoke('material:load'),
  saveMaterialPreference: (material: string): Promise<void> =>
    ipcRenderer.invoke('material:save', material),
  getMaterialCapability: (): Promise<{ supportsGlass: boolean; supportsFrost: boolean; supportsPure: boolean; reason: string | null; isWindows: boolean; reducedTransparency: boolean }> =>
    ipcRenderer.invoke('material:capability'),
  runDoctor: (): Promise<DoctorReport> => ipcRenderer.invoke('doctor:run'),
  getWorkGraphRevision: (projectId?: string): Promise<{ revision: WorkGraphRevision | null; error?: string }> =>
    ipcRenderer.invoke('workgraph:get', projectId),
  getFixtureWorkGraph: (): Promise<{ revision: WorkGraphRevision | null; error?: string }> =>
    ipcRenderer.invoke('workgraph:fixture'),
  onMaterialChanged: (cb: (pref: { material: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, pref: unknown) => cb(pref as { material: string });
    ipcRenderer.on('material:changed', listener);
    return () => ipcRenderer.removeListener('material:changed', listener);
  },
} satisfies WorkbenchContract;

export type WorkbenchApi = typeof api;

/**
 * Internal — listed for the contract test to keep `preload/index.ts`
 * implementation and `src/preload/contract.ts` in lockstep. Not exposed
 * to the renderer via `contextBridge`.
 */
export const __workbenchApiKeys: ReadonlyArray<string> = Object.keys(api);

if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
  contextBridge.exposeInMainWorld('wb', api);
}
