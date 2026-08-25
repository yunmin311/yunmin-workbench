import type {
  Conversation,
  GitFacts,
  Observation,
  OverlaySnapshot,
  RuntimeBinding,
} from '../types';

/**
 * Execution Binding candidate (Integrity §2): project only what current real
 * data can confirm. Fields that cannot be confirmed from canonical files or
 * processes stay undefined => UI renders UNKNOWN. Never guessed.
 *
 *   harness            <- conversation.platform (canonical-file: registry)
 *   machine            <- machine profile device_id (canonical-file)
 *   cwd (project root) <- machine profile project_roots (canonical-file)
 *   branch / HEAD      <- git facts (process observation), if loaded
 *   externalSessionRef <- registry session_id, only when VERIFIED
 */
export interface BindingCandidate {
  binding: RuntimeBinding;
  observed: Observation;
}

export function bindingCandidate(
  snapshot: OverlaySnapshot,
  conversation: Conversation,
  git: GitFacts | null,
): BindingCandidate {
  const machine = snapshot.machine;
  const localRoot = machine?.projectRoots[conversation.project];
  const gitForProject = git && git.projectId === conversation.project ? git : null;

  const binding: RuntimeBinding = {
    harness: conversation.platform, // registry-declared platform
    machine: machine?.deviceId ?? 'UNKNOWN',
    cwd: localRoot,
    branch: gitForProject?.branch,
    head: gitForProject?.head,
    externalSessionRef:
      conversation.verification === 'VERIFIED' ? conversation.sessionId : undefined,
  };

  const observed: Observation = {
    source: 'canonical-file',
    sourceRef: conversation.observed.sourceRef,
    observedAt: new Date().toISOString(),
    verification:
      binding.machine !== 'UNKNOWN' && binding.cwd && gitForProject?.head
        ? 'OBSERVED'
        : 'UNKNOWN',
  };
  return { binding, observed };
}
