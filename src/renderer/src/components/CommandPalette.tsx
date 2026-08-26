import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { discoverProjects } from '../../../core/project/discovery';
import { useWorkbench } from '../store';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const {
    snapshot, projectId, conversation, workspaceSession, setView, selectProject, selectConversation,
    resumeWorkspace, reloadAndRecheck, clearDraft,
  } = useWorkbench();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || (event.shiftKey && event.key.toLowerCase() === 'p'))) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        const actions = [
          () => setView('projects'),
          () => projectId && setView('control'),
          () => projectId && setView('canvas'),
          () => projectId && setView('context'),
          () => projectId && setView('packet'),
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
  }, [projectId, reloadAndRecheck, setView]);

  if (!open || !snapshot) return null;
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const packetAction = (name: 'copy' | 'handoff') => run(() => {
    if (!projectId || !conversation) return;
    setView('packet');
    setTimeout(() => window.dispatchEvent(new CustomEvent(`workbench:${name}-agent-input`)), 0);
  });
  const switchSession = (key: string) => {
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
          <Command.Item onSelect={() => run(() => setView('projects'))}><span>Home / Overview</span><kbd>Ctrl 1</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => setView('control'))}><span>Active Work Surface</span><kbd>Ctrl 2</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => setView('canvas'))}><span>Canvas</span><kbd>Ctrl 3</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => setView('context'))}><span>Context Inspector</span><kbd>Ctrl 4</kbd></Command.Item>
          <Command.Item disabled={!projectId} onSelect={() => run(() => setView('packet'))}><span>Packet Inspector</span><kbd>Ctrl 5</kbd></Command.Item>
        </Command.Group>
        <Command.Group heading="Open Workspace">
          {workspaceSession.last && (
            <Command.Item onSelect={() => run(() => resumeWorkspace())}>Resume Last Workspace</Command.Item>
          )}
          {discoverProjects(snapshot).map((project) => (
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
          {snapshot.conversations.map((item) => (
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
          <Command.Item disabled={!conversation} onSelect={() => packetAction('copy')}>Copy Agent Input</Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => packetAction('handoff')}>Dispatch to Codex</Command.Item>
          <Command.Item onSelect={() => run(() => void reloadAndRecheck())}>Reload External Truth</Command.Item>
          <Command.Item disabled={!conversation} onSelect={() => run(() => void clearDraft())}>Clear Draft</Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
