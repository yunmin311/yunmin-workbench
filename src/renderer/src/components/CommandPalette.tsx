import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { discoverProjects } from '../../../core/project/discovery';
import { useWorkbench, type View } from '../store';

const viewCommands: { view: View; label: string; shortcut: string }[] = [
  { view: 'projects', label: 'Projects', shortcut: 'Ctrl 1' },
  { view: 'control', label: 'Control Room', shortcut: 'Ctrl 2' },
  { view: 'canvas', label: 'Canvas', shortcut: 'Ctrl 3' },
  { view: 'context', label: 'Context Staging', shortcut: 'Ctrl 4' },
  { view: 'packet', label: 'Packet Preview', shortcut: 'Ctrl 5' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const {
    snapshot, projectId, workspaceSession, setView, selectProject, selectConversation,
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
        const command = viewCommands[Number(event.key) - 1];
        if (command.view === 'projects' || projectId) setView(command.view);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void reloadAndRecheck();
      }
    };
    window.addEventListener('keydown', onKey);
    const onOpen = () => setOpen(true);
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
    if (!projectId) return;
    setView('packet');
    setTimeout(() => window.dispatchEvent(new CustomEvent(`workbench:${name}-agent-input`)), 0);
  });

  return (
    <Command.Dialog
      open
      onOpenChange={setOpen}
      label="Workbench commands and quick switcher"
      className="command-dialog"
      overlayClassName="command-backdrop"
    >
        <Command.Input autoFocus placeholder="Open project, switch conversation, run command…" />
        <Command.List>
          <Command.Empty>No matching project, conversation, or command.</Command.Empty>
          <Command.Group heading="Navigate">
            {viewCommands.map((command) => (
              <Command.Item
                key={command.view}
                disabled={command.view !== 'projects' && !projectId}
                onSelect={() => run(() => setView(command.view))}
              >
                <span>{command.label}</span><kbd>{command.shortcut}</kbd>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Workspace">
            {workspaceSession.last && (
              <Command.Item onSelect={() => run(() => resumeWorkspace())}>Resume Last Workspace</Command.Item>
            )}
            {discoverProjects(snapshot).map((project) => (
              <Command.Item key={`project:${project.projectId}`} value={`Open Project ${project.displayName} ${project.projectId}`} onSelect={() => run(() => selectProject(project.projectId))}>
                Open Project · {project.displayName}
              </Command.Item>
            ))}
            {snapshot.conversations.map((conversation) => (
              <Command.Item
                key={`conversation:${conversation.key}`}
                value={`Switch Conversation ${conversation.role} ${conversation.project}`}
                onSelect={() => run(() => {
                  if (projectId !== conversation.project) selectProject(conversation.project);
                  selectConversation(conversation);
                  setView('context');
                })}
              >
                Switch Conversation · {conversation.project} / {conversation.role}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Actions">
            <Command.Item disabled={!projectId} onSelect={() => packetAction('copy')}>Copy Agent Input</Command.Item>
            <Command.Item disabled={!projectId} onSelect={() => packetAction('handoff')}>Handoff to Codex</Command.Item>
            <Command.Item onSelect={() => run(() => void reloadAndRecheck())}>Reload External Truth</Command.Item>
            <Command.Item disabled={!projectId} onSelect={() => run(() => void clearDraft())}>Clear Draft</Command.Item>
          </Command.Group>
        </Command.List>
    </Command.Dialog>
  );
}
