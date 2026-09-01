import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { discoverProjects } from '../../../core/project/discovery';
import { useWorkbench } from '../store';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const snapshot = useWorkbench((state) => state.snapshot);
  const projectId = useWorkbench((state) => state.projectId);
  const conversation = useWorkbench((state) => state.conversation);
  const workspaceSession = useWorkbench((state) => state.workspaceSession);
  const setView = useWorkbench((state) => state.setView);
  const selectProject = useWorkbench((state) => state.selectProject);
  const selectConversation = useWorkbench((state) => state.selectConversation);
  const resumeWorkspace = useWorkbench((state) => state.resumeWorkspace);
  const reloadAndRecheck = useWorkbench((state) => state.reloadAndRecheck);
  const clearDraft = useWorkbench((state) => state.clearDraft);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || (event.shiftKey && event.key.toLowerCase() === 'p'))) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        const actions = [
          () => window.dispatchEvent(new CustomEvent('workbench:open-session-picker')),
          () => projectId && setView('canvas'),
          () => projectId && window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' })),
          () => conversation && window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' })),
        ];
        actions[Number(event.key) - 1]?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void reloadAndRecheck();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('workbench:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('workbench:open-command-palette', onOpen);
    };
  }, [conversation, projectId, reloadAndRecheck, setView]);

  if (!open) return null;
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const packetAction = (name: 'copy' | 'handoff') => run(() => {
    if (!projectId || !conversation) return;
    window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' }));
    setTimeout(() => window.dispatchEvent(new CustomEvent(`workbench:${name}-agent-input`)), 0);
  });
  const switchSession = (key: string) => {
    if (!snapshot) return;
    const next = snapshot.conversations.find((item) => item.key === key);
    if (!next) return;
    if (projectId !== next.project) selectProject(next.project);
    selectConversation(next);
    setView('control');
  };

  return (
    <Command.Dialog
      open
      onOpenChange={setOpen}
      label="Workbench commands and session switcher"
      className="command-dialog"
      overlayClassName="command-backdrop"
    >
      <Command.Input autoFocus placeholder="Open workspace, switch session, run command…" />
      <Command.List>
        <Command.Empty>No matching workspace, session, or command.</Command.Empty>
        <Command.Group heading="Navigate">
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-attention')))}>Review Attention</Command.Item>
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-history')))}>Search History</Command.Item>
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-memory')))}>Search Memory</Command.Item>
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-doctor')))}>Workbench Doctor</Command.Item>
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-session-picker')))}><span>Open Workspace / Switch Session</span><kbd>Ctrl 1</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => setView('canvas'))}><span>Canvas</span><kbd>Ctrl 2</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'context' })))}><span>Context Inspector</span><kbd>Ctrl 3</kbd></Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-inspector', { detail: 'packet' })))}><span>Packet</span><kbd>Ctrl 4</kbd></Command.Item>
        </Command.Group>
        <Command.Group heading="Open Workspace">
          {workspaceSession.last && (
            <Command.Item onSelect={() => run(() => resumeWorkspace())}>Resume Last Workspace</Command.Item>
          )}
          {snapshot && discoverProjects(snapshot).map((project) => (
            <Command.Item
              key={`project:${project.projectId}`}
              value={`Open Workspace ${project.displayName} ${project.projectId}`}
              onSelect={() => run(() => selectProject(project.projectId))}
            >
              Open Workspace · {project.displayName}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Switch Session">
          {snapshot?.conversations.map((item) => (
            <Command.Item
              key={`conversation:${item.key}`}
              value={`Switch Session ${item.role} ${item.project}`}
              onSelect={() => run(() => switchSession(item.key))}
            >
              Switch Session · {item.project} / {item.role}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Actions">
          <Command.Item onSelect={() => run(() => window.dispatchEvent(new CustomEvent('workbench:open-portability')))}>Profile Portability</Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => packetAction('copy')}>Copy Agent Input</Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => packetAction('handoff')}>Dispatch to Codex</Command.Item>
          <Command.Item onSelect={() => run(() => void reloadAndRecheck())}>Reload External Truth</Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => run(() => void clearDraft())}>Clear Draft</Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
