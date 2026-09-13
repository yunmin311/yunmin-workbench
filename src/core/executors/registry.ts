/**
 * Executor registry — typed, in-process lookup of declared `Executor`
 * capability contracts.
 *
 * Scope:
 * - Owns the list of declared executors and nothing else.
 * - No cache, no SOT, no durable state, no watcher, no polling.
 *
 * Invariants:
 * 1. Every entry has a unique `id`. Duplicate `register(executor)`
 *    calls for the same id are rejected with `ALREADY_REGISTERED`.
 * 2. `id` MUST equal `executor.identity.id` (which equals `${backend}:${provider}`).
 *    Mismatched ids are rejected with `ID_MISMATCH`.
 * 3. Capability answers must be YES / NO / UNKNOWN; anything else is
 *    `INVALID_CAPABILITY`.
 * 4. `list()` returns a fresh array; the caller may mutate freely.
 *
 * Compatibility note (Paseo):
 * - Concrete executor adapters are registered in PHASE 2B+. The
 *   registry type is in place so that the Paseo adapter can declare
 *   itself without contract changes.
 */
import type {
  CapabilityAnswer,
  ExecutionIdentity,
  Executor,
  ExecutorRegistryEntry,
} from './types';

export type ExecutorRegistryErrorCode =
  | 'ALREADY_REGISTERED'
  | 'ID_MISMATCH'
  | 'INVALID_CAPABILITY';

export interface ExecutorRegistryError {
  code: ExecutorRegistryErrorCode;
  message: string;
}

export type ExecutorRegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExecutorRegistryError };

const VALID_ANSWERS: ReadonlySet<CapabilityAnswer> = new Set<CapabilityAnswer>(['YES', 'NO', 'UNKNOWN']);

function validateCapabilities(executor: Executor): ExecutorRegistryError | null {
  const caps = executor.capabilities;
  const entries: Array<[string, CapabilityAnswer]> = [
    ['discover', caps.discover.answer],
    ['capabilities', caps.capabilities.answer],
    ['dispatch', caps.dispatch.answer],
    ['observe', caps.observe.answer],
    ['cancel', caps.cancel.answer],
    ['resume', caps.resume.answer],
  ];
  for (const [name, answer] of entries) {
    if (!VALID_ANSWERS.has(answer)) {
      return {
        code: 'INVALID_CAPABILITY',
        message: `executor ${executor.id} declares capability "${name}" with answer "${answer}", expected YES/NO/UNKNOWN`,
      };
    }
  }
  return null;
}

function validateIdentity(executor: Executor): ExecutorRegistryError | null {
  const expectedId = executor.identity.id;
  if (executor.id !== expectedId) {
    return {
      code: 'ID_MISMATCH',
      message: `executor id "${executor.id}" must equal identity.id "${expectedId}" (backend: ${executor.identity.backend}, provider: ${executor.identity.provider})`,
    };
  }
  // Also validate backend:provider format
  const parts = expectedId.split(':');
  if (parts.length !== 2) {
    return {
      code: 'ID_MISMATCH',
      message: `identity.id "${expectedId}" must be in "backend:provider" format`,
    };
  }
  return null;
}

export class ExecutorRegistry {
  private readonly entries: Map<string, ExecutorRegistryEntry>;

  constructor() {
    this.entries = new Map();
  }

  register(executor: Executor): ExecutorRegistryResult<ExecutorRegistryEntry> {
    if (this.entries.has(executor.id)) {
      return {
        ok: false,
        error: {
          code: 'ALREADY_REGISTERED',
          message: `executor id "${executor.id}" is already registered`,
        },
      };
    }
    const identityError = validateIdentity(executor);
    if (identityError) {
      return { ok: false, error: identityError };
    }
    const capabilityError = validateCapabilities(executor);
    if (capabilityError) {
      return { ok: false, error: capabilityError };
    }
    const entry: ExecutorRegistryEntry = {
      executor,
      registeredAt: new Date().toISOString(),
    };
    this.entries.set(executor.id, entry);
    return { ok: true, value: entry };
  }

  get(id: string): Executor | null {
    return this.entries.get(id)?.executor ?? null;
  }

  /**
   * Get executor by backend and provider.
   */
  getByBackendAndProvider(backend: string, provider: string): Executor | null {
    return this.get(`${backend}:${provider}`) ?? null;
  }

  list(): ExecutorRegistryEntry[] {
    return [...this.entries.values()];
  }

  listByBackend(backend: string): ExecutorRegistryEntry[] {
    return this.list().filter((entry) => entry.executor.identity.backend === backend);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  size(): number {
    return this.entries.size;
  }
}