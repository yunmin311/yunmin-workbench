/**
 * Preload contract — typed renderer-facing IPC surface for the Workbench.
 *
 * Scope:
 * - Type-only description of `window.wb.*` API. It mirrors the existing
 *   preload `src/preload/index.ts` byte-for-byte in method names,
 *   argument shapes, and return types.
 * - Transport-neutral: it does NOT import `electron`, the IPC runtime,
 *   or the main-process types. Renderer-side consumers (legacy + vNext)
 *   and tests can import this file to consume the contract without
 *   dragging in the electron runtime.
 *
 * What this is NOT:
 * - Not an implementation. The actual `ipcRenderer.invoke`/`send` calls
 *   stay in `src/preload/index.ts`. The implementation file asserts
 *   `satisfies WorkbenchContract` so a drift between contract and
 *   implementation is a compile error.
 * - Not a second SOT. It only re-states the channel layout that the
 *   legacy main `registerIpc()` already defines.
 *
 * Invariant: this contract is frozen for PHASE 1. Any widening — new
 * methods, new argument shapes, new return types — must go through
 * a new contract version so legacy renderer consumers can stay on
 * `WorkbenchContractV1` until they choose to migrate.
 */
import type {
  ActivityEvent,
  AttentionLocalState,
  ContextItem,
  ExecutionEnvironment,
  FrozenPacket,
  FrozenPacketSummary,
  GitFacts,
  HandoffReceipt,
  HarnessCapabilities,
  HarnessDispatchRequest,
  HarnessSessionPresence,
  OverlaySnapshot,
  SourceFingerprint,
  TaskPacket,
} from '../core/types';
import type { WorkGraphRevision } from '../core/workgraph/revision';
import type { WorkbenchDraftV1 } from '../core/project/draft';
import type { CabinetStagingV1 } from '../core/project/cabinetStaging';
import type { WorkspaceSessionV1 } from '../core/project/workspaceSession';
import type { HistoryCatalogResult, HistoryQuery, HistorySearchResult, HistorySessionDetail } from '../core/history/types';
import type { ProfileImportPreview } from '../core/portability/bundle';
import type { ProjectRootBindingsV1 } from '../main/projectRootBindings';
import type { MemoryEvidenceExpansion, MemorySearchQuery, MemorySearchResult, MemoryUseStateV1 } from '../core/memory/types';
import type { DoctorReport } from '../main/doctor';

export interface WorkbenchContractV1 {
  loadOverlay(opts?: { refresh?: boolean }): Promise<OverlaySnapshot>;
  chooseOverlay(): Promise<{ canceled?: boolean; root?: string; observedAt?: string; error?: string }>;
  loadOverlayBinding(): Promise<{ root: string; observedAt: string } | null>;

  freezePacket(packet: TaskPacket): Promise<{ frozen: FrozenPacket; path: string }>;
  listFrozen(
    projectId: string,
    conversationId: string,
  ): Promise<{ packets: FrozenPacketSummary[]; problems: { file: string; message: string }[] }>;
  readFrozenDetail(
    projectId: string,
    conversationId: string,
    query: { version: number } | { hash: string },
  ): Promise<FrozenPacket | null>;

  readMemory(memoryId: string): Promise<string | null>;
  loadGit(projectId: string): Promise<{ facts?: GitFacts; error?: string }>;
  chooseProjectFile(
    projectId: string,
    asReference: boolean,
  ): Promise<{ item?: ContextItem; fingerprint?: SourceFingerprint; error?: string; canceled?: boolean }>;
  refreshProjectFiles(
    projectId: string,
    files: { relativePath: string; asReference: boolean }[],
  ): Promise<{ entries: { item: ContextItem; fingerprint: SourceFingerprint }[]; errors: string[] }>;
  recheckSources(
    projectId: string,
    sourceRefs: string[],
  ): Promise<{ checkedSourceRefs: string[]; fingerprints: SourceFingerprint[]; errors: { sourceRef: string; message: string }[] }>;

  loadDraft(
    projectId: string,
    conversationKey: string,
  ): Promise<{ draft: WorkbenchDraftV1 | null; problem?: string }>;
  saveDraft(draft: WorkbenchDraftV1): Promise<{ path: string }>;
  clearDraft(projectId: string, conversationKey: string): Promise<void>;

  loadCabinetStaging(
    projectId: string,
  ): Promise<{ staging: CabinetStagingV1 | null; problem?: string; migrated?: boolean }>;
  saveCabinetStaging(staging: CabinetStagingV1): Promise<{ path: string }>;
  getCurrentSelection(): Promise<unknown>;
  setCurrentSelection(selection: { projectId: string; workId?: string; taskId?: string }): Promise<void>;
  toggleCompactWindow(): Promise<{ visible: boolean }>;
  setCompactExpanded(expanded: boolean): Promise<{ expanded: boolean }>;
  openWorkbenchFromCompact(identity: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' }): Promise<{ focused: boolean }>;
  onCompactNavigate(cb: (identity: { projectId: string; workId?: string; taskId?: string; action?: 'continue' | 'prepare' }) => void): () => void;
  searchProjectFiles(
    projectId: string,
    query: string,
  ): Promise<{ matches: string[]; errors: string[] }>;
  readPinnedProjectFile(
    projectId: string,
  ): Promise<{ item?: ContextItem; fingerprint?: SourceFingerprint; error?: string }>;

  loadWorkspaceSession(): Promise<{ session: WorkspaceSessionV1 | null; problem?: string }>;
  saveWorkspaceSession(session: WorkspaceSessionV1): Promise<{ path: string }>;

  loadHarnessCapabilities(): Promise<HarnessCapabilities>;
  loadAllHarnessCapabilities(
    environment?: ExecutionEnvironment,
  ): Promise<Record<string, HarnessCapabilities>>;
  listHarnessSessions(projectId: string): Promise<HarnessSessionPresence[]>;
  dispatchToHarness(request: HarnessDispatchRequest): Promise<HandoffReceipt>;
  smokeHarness(
    projectId: string,
    harness: HarnessCapabilities['harness'],
  ): Promise<HandoffReceipt | { userAgent: string; ephemeralThreadId: string } | HarnessSessionPresence[]>;

  loadLiveExecutions(): Promise<
    { executionId: string; harness: string; externalSessionRef: string; startedAt: string; canCancel: boolean }[]
  >;
  cancelExecution(executionId: string): Promise<{ delivered: boolean; reason?: string }>;

  loadActivity(options?: { beforeByte?: number; limit?: number }): Promise<{
    events: ActivityEvent[];
    problem?: string;
    rejectedLines: number;
    nextBeforeByte?: number;
    hasEarlier: boolean;
  }>;
  clearActivity(): Promise<void>;

  loadAttentionLocal(): Promise<AttentionLocalState>;
  dismissAttention(itemId: string, observedAt: string): Promise<void>;

  listHistory(): Promise<HistoryCatalogResult>;
  searchHistory(query: HistoryQuery): Promise<HistorySearchResult>;
  readHistoryDetail(sessionId: string): Promise<HistorySessionDetail | null>;

  searchMemory(query: MemorySearchQuery): Promise<MemorySearchResult>;
  expandMemory(id: string): Promise<MemoryEvidenceExpansion | null>;
  recordMemoryUse(id: string): Promise<MemoryUseStateV1>;

  previewProfileExport(): Promise<{
    preview: {
      digest: string;
      drafts: number;
      manualContexts: number;
      projectBindings: number;
      workspaceSession: boolean;
      included: string[];
      skipped: string[];
    };
  }>;
  applyProfileExport(digest: string): Promise<{ canceled?: boolean; path?: string }>;
  loadProjectRootBindings(): Promise<ProjectRootBindingsV1>;
  previewProfileImport(): Promise<{ canceled?: boolean; preview?: ProfileImportPreview }>;
  applyProfileImport(digest: string): Promise<{ imported: true }>;
  rebindProjectRoot(projectId: string): Promise<{ canceled?: boolean; binding?: { root: string; verifiedAt: string } }>;

  onActivityChanged(cb: (event: ActivityEvent) => void): () => void;
  onActivityCleared(cb: () => void): () => void;
  copyText(text: string): Promise<void>;

  onDraftFlushRequest(cb: () => void): () => void;
  draftsFlushSettled(result: { attempted: number; failed: number }): void;
  onOverlayChanged(cb: () => void): () => void;
  onAppFocus(cb: () => void): () => void;

  onIslandSourceSelected(cb: (target: {
    projectId?: string;
    conversationKey?: string;
    sessionRef?: string;
    sourceRef: string;
    eventRef?: string;
  }) => void): () => void;
  syncIslandAttention(items: unknown): void;

  loadMaterialPreference(): Promise<{ material: string }>;
  saveMaterialPreference(material: string): Promise<void>;
  getMaterialCapability(): Promise<{
    supportsGlass: boolean;
    supportsFrost: boolean;
    supportsPure: boolean;
    reason: string | null;
    isWindows: boolean;
    reducedTransparency: boolean;
  }>;
  runDoctor(): Promise<DoctorReport>;
  onMaterialChanged(cb: (pref: { material: string }) => void): () => void;
  getWorkGraphRevision(projectId?: string): Promise<{ revision: WorkGraphRevision | null; error?: string }>;
  getFixtureWorkGraph(): Promise<{ revision: WorkGraphRevision | null; error?: string }>;
}

export type WorkbenchContract = WorkbenchContractV1;

/**
 * Runtime marker — let `Object.keys` enumerate the contract method
 * names for the contract test. The proxy reports the contract's typed
 * method names as own keys; every property access returns a no-op
 * function. The actual implementation lives in `src/preload/index.ts`.
 */
type ContractMethodNames = Exclude<keyof WorkbenchContractV1, never>;
const CONTRACT_METHOD_NAMES: ReadonlyArray<ContractMethodNames> = [
  'loadOverlay',
  'chooseOverlay',
  'loadOverlayBinding',
  'freezePacket',
  'listFrozen',
  'readFrozenDetail',
  'readMemory',
  'loadGit',
  'chooseProjectFile',
  'refreshProjectFiles',
  'recheckSources',
  'loadDraft',
  'saveDraft',
  'clearDraft',
  'loadCabinetStaging',
  'saveCabinetStaging',
  'getCurrentSelection',
  'setCurrentSelection',
  'toggleCompactWindow',
  'setCompactExpanded',
  'openWorkbenchFromCompact',
  'onCompactNavigate',
  'searchProjectFiles',
  'readPinnedProjectFile',
  'loadWorkspaceSession',
  'saveWorkspaceSession',
  'loadHarnessCapabilities',
  'loadAllHarnessCapabilities',
  'listHarnessSessions',
  'dispatchToHarness',
  'smokeHarness',
  'loadLiveExecutions',
  'cancelExecution',
  'loadActivity',
  'clearActivity',
  'loadAttentionLocal',
  'dismissAttention',
  'listHistory',
  'searchHistory',
  'readHistoryDetail',
  'searchMemory',
  'expandMemory',
  'recordMemoryUse',
  'previewProfileExport',
  'applyProfileExport',
  'loadProjectRootBindings',
  'previewProfileImport',
  'applyProfileImport',
  'rebindProjectRoot',
  'onActivityChanged',
  'onActivityCleared',
  'copyText',
  'onDraftFlushRequest',
  'draftsFlushSettled',
  'onOverlayChanged',
  'onAppFocus',
  'onIslandSourceSelected',
  'syncIslandAttention',
  'loadMaterialPreference',
  'saveMaterialPreference',
  'getMaterialCapability',
  'runDoctor',
  'onMaterialChanged',
  'getWorkGraphRevision',
  'getFixtureWorkGraph',
];

const contractMethodMarker: WorkbenchContractV1 = new Proxy({} as WorkbenchContractV1, {
  has(_target, key) {
    return typeof key === 'string' && (CONTRACT_METHOD_NAMES as ReadonlyArray<string>).includes(key);
  },
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    if (!(CONTRACT_METHOD_NAMES as ReadonlyArray<string>).includes(key)) return undefined;
    return () => undefined;
  },
  ownKeys() {
    return [...CONTRACT_METHOD_NAMES];
  },
  getOwnPropertyDescriptor(_target, key) {
    if (typeof key !== 'string') return undefined;
    if (!(CONTRACT_METHOD_NAMES as ReadonlyArray<string>).includes(key)) return undefined;
    return { configurable: true, enumerable: true, value: () => undefined, writable: true };
  },
});

export const __workbenchContractV1Methods: Readonly<WorkbenchContractV1> = contractMethodMarker;
