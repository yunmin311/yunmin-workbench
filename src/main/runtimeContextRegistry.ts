import type { HarnessCapabilities } from '../core/types';

type Harness = HarnessCapabilities['harness'];

/** Process-local correlation keyed by the full external identity tuple. */
export class RuntimeContextRegistry<T> {
  private contexts = new Map<string, T>();

  private key(harness: Harness, externalSessionRef: string): string {
    return `${harness}\0${externalSessionRef}`;
  }

  set(harness: Harness, externalSessionRef: string, context: T): void {
    this.contexts.set(this.key(harness, externalSessionRef), context);
  }

  get(harness: Harness, externalSessionRef: string): T | undefined {
    return this.contexts.get(this.key(harness, externalSessionRef));
  }
}
