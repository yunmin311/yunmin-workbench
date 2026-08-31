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
  /** Each contributing source stays visible; mixed file+process evidence is not collapsed. */
  evidence: Observation[];
  verification: Observation['verification'];
}

export function bindingCandidate(
  snapshot: OverlaySnapshot,
  conversation: Conversation,
  git: GitFacts | null,
): BindingCandidate {
  const machine = snapshot.machine;
  const localBinding = snapshot.workbenchProjectRoots?.[conversation.project];
  const localRoot = localBinding?.root ?? machine?.projectRoots[conversation.project];
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

  const evidence: Observation[] = [conversation.observed];
  if (machine) evidence.push(machine.observed);
  if (localBinding) evidence.push(localBinding.observed);
  if (gitForProject) evidence.push(gitForProject.observed);
  const verification =
    binding.machine !== 'UNKNOWN' && binding.cwd && gitForProject?.head
      ? 'OBSERVED'
      : 'UNKNOWN';
  return { binding, evidence, verification };
}
