import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ContextItem, FrozenPacket, GitFacts, OverlaySnapshot, SourceFingerprint, TaskPacket } from '../core/types';

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
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
  onOverlayChanged: (cb: () => void): (() => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on('overlay:changed', listener);
    return () => ipcRenderer.removeListener('overlay:changed', listener);
  },
};

export type WorkbenchApi = typeof api;

contextBridge.exposeInMainWorld('wb', api);
