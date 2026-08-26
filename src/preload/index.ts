import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ActivityEvent, ContextItem, FrozenPacket, GitFacts, HandoffReceipt, HarnessCapabilities, OverlaySnapshot, SourceFingerprint, TaskPacket } from '../core/types';
import type { WorkbenchDraftV1 } from '../core/project/draft';
import type { WorkspaceSessionV1 } from '../core/project/workspaceSession';

const api = {
  loadOverlay: (opts?: { refresh?: boolean }): Promise<OverlaySnapshot> =>
    ipcRenderer.invoke('overlay:load', opts),
  freezePacket: (packet: TaskPacket): Promise<{ frozen: FrozenPacket; path: string }> =>
    ipcRenderer.invoke('packet:freeze', packet),
  listFrozen: (projectId: string, conversationId: string): Promise<FrozenPacket[]> =>
    ipcRenderer.invoke('packet:list', projectId, conversationId),
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
  loadWorkspaceSession: (): Promise<{ session: WorkspaceSessionV1 | null; problem?: string }> =>
    ipcRenderer.invoke('workspace:load'),
  saveWorkspaceSession: (session: WorkspaceSessionV1): Promise<{ path: string }> =>
    ipcRenderer.invoke('workspace:save', session),
  loadHarnessCapabilities: (): Promise<HarnessCapabilities> =>
    ipcRenderer.invoke('harness:capabilities'),
  dispatchToHarness: (request: {
    intentId: string;
    projectId: string;
    conversationKey: string;
    packetText: string;
  }): Promise<HandoffReceipt> => ipcRenderer.invoke('harness:dispatch', request),
  smokeHarness: (projectId: string): Promise<{ userAgent: string; ephemeralThreadId: string }> =>
    ipcRenderer.invoke('harness:smoke', projectId),
  loadActivity: (): Promise<{ events: ActivityEvent[]; problem?: string }> =>
    ipcRenderer.invoke('activity:load'),
  clearActivity: (): Promise<void> => ipcRenderer.invoke('activity:clear'),
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
};

export type WorkbenchApi = typeof api;

contextBridge.exposeInMainWorld('wb', api);
