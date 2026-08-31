import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const islandApi = {
  onSnapshot: (cb: (snapshot: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, snapshot: unknown) => cb(snapshot);
    ipcRenderer.on('island:snapshot', listener);
    return () => ipcRenderer.removeListener('island:snapshot', listener);
  },
  onExpanded: (cb: (expanded: boolean) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, expanded: boolean) => cb(expanded);
    ipcRenderer.on('island:expanded', listener);
    return () => ipcRenderer.removeListener('island:expanded', listener);
  },
  toggleExpansion: (): Promise<{ expanded: boolean }> =>
    ipcRenderer.invoke('island:toggle-expansion'),
  savePosition: (x: number, y: number): Promise<void> =>
    ipcRenderer.invoke('island:save-position', { x, y }),
  dismissAttention: (itemId: string, observedAt: string): Promise<void> =>
    ipcRenderer.invoke('attention:dismiss', { itemId, observedAt }),
};

contextBridge.exposeInMainWorld('island', islandApi);

type SourceTarget = {
  projectId?: string;
  conversationKey?: string;
  sessionRef?: string;
  sourceRef: string;
  eventRef?: string;
};

const electronApi = {
  moveWindow: (dx: number, dy: number) => {
    ipcRenderer.send('island:move', { dx, dy });
  },
  getWindowPosition: (): { x: number; y: number } | null => {
    return null;
  },
  openSource: (target: SourceTarget) => {
    ipcRenderer.send('island:open-source', target);
  },
};

contextBridge.exposeInMainWorld('electron', electronApi);

export type IslandApi = typeof islandApi;
export type ElectronApi = typeof electronApi;