import type { IslandApi, ElectronApi } from '../preload/island';

declare global {
  interface Window {
    island: IslandApi;
    electron?: ElectronApi;
  }
}

export {};