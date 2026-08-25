import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { FrozenPacket, GitFacts, OverlaySnapshot, TaskPacket } from '../core/types';

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
  onOverlayChanged: (cb: () => void): (() => void) => {
    const listener = (_e: IpcRendererEvent) => cb();
    ipcRenderer.on('overlay:changed', listener);
    return () => ipcRenderer.removeListener('overlay:changed', listener);
  },
};

export type WorkbenchApi = typeof api;

contextBridge.exposeInMainWorld('wb', api);
