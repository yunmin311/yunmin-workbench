import type { WorkbenchApi } from '../../preload/index';

declare global {
  interface Window {
    wb: WorkbenchApi;
  }
}

export {};
