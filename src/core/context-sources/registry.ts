/**
 * Context Source registry — a typed, in-process lookup of registered
 * `ContextSource` capability declarations.
 *
 * Scope:
 * - Owns the list of declared sources and nothing else.
 * - No cache, no SOT, no durable state, no watcher, no polling.
 * - The registry is purely an in-memory container; main-process code
 *   builds it at composition time and renderer sees it only via the
 *   existing preload/IPC surface.
 *
 * Invariants the registry guarantees:
 * 1. Every entry has a unique `id`. Duplicate `register(source)` calls
 *    for the same id are rejected with `ALREADY_REGISTERED`; the
 *    previously registered entry stays untouched. This is a safety
 *    net for the audit window — sources never silently overwrite
 *    each other.
 * 2. `id` MUST equal a value derived from `source.kind`; mismatched
 *    ids are rejected with `ID_MISMATCH`. This keeps future adapters
 *    honest about their identity.
 * 3. Capability answers must be one of YES / NO / UNKNOWN. Anything
 *    else is rejected with `INVALID_CAPABILITY`.
 * 4. `list()` always returns a fresh array; the caller is free to
 *    mutate it without affecting the registry.
 */
import type {
  CapabilityAnswer,
  ContextSource,
  ContextSourceRegistryEntry,
} from './types';

export type RegistryErrorCode =
  | 'ALREADY_REGISTERED'
  | 'ID_MISMATCH'
  | 'INVALID_CAPABILITY';

export interface RegistryError {
  code: RegistryErrorCode;
  message: string;
}

export type RegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RegistryError };

const VALID_ANSWERS: ReadonlySet<CapabilityAnswer> = new Set<CapabilityAnswer>(['YES', 'NO', 'UNKNOWN']);

function validateCapabilities(source: ContextSource): RegistryError | null {
  const caps = source.capabilities;
  const entries: Array<[string, CapabilityAnswer]> = [
    ['list', caps.list.answer],
    ['search', caps.search.answer],
    ['read', caps.read.answer],
    ['fingerprint', caps.fingerprint.answer],
    ['recheck', caps.recheck.answer],
  ];
  for (const [name, answer] of entries) {
    if (!VALID_ANSWERS.has(answer)) {
      return {
        code: 'INVALID_CAPABILITY',
        message: `source ${source.id} declares capability "${name}" with answer "${answer}", expected YES/NO/UNKNOWN`,
      };
    }
  }
  return null;
}

function idFromKind(kind: ContextSource['kind']): string {
  return kind;
}

export class ContextSourceRegistry {
  private readonly entries: Map<string, ContextSourceRegistryEntry>;

  constructor() {
    this.entries = new Map();
  }

  register(source: ContextSource): RegistryResult<ContextSourceRegistryEntry> {
    if (this.entries.has(source.id)) {
      return {
        ok: false,
        error: {
          code: 'ALREADY_REGISTERED',
          message: `source id "${source.id}" is already registered`,
        },
      };
    }
    if (idFromKind(source.kind) !== source.id) {
      return {
        ok: false,
        error: {
          code: 'ID_MISMATCH',
          message: `source id "${source.id}" must equal kind "${source.kind}"`,
        },
      };
    }
    const capabilityError = validateCapabilities(source);
    if (capabilityError) {
      return { ok: false, error: capabilityError };
    }
    const entry: ContextSourceRegistryEntry = {
      source,
      registeredAt: new Date().toISOString(),
    };
    this.entries.set(source.id, entry);
    return { ok: true, value: entry };
  }

  get(id: string): ContextSource | null {
    return this.entries.get(id)?.source ?? null;
  }

  /**
   * Snapshot of currently registered sources. The returned array is a
   * fresh copy; callers can mutate it freely.
   */
  list(): ContextSourceRegistryEntry[] {
    return [...this.entries.values()];
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  size(): number {
    return this.entries.size;
  }
}