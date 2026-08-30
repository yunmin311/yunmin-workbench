# Third-Party Notices

This repository contains or adapts renderer and interaction ideas from the
projects listed below. These were introduced with the Reasonix prototype shell,
which has since been merged into `main`; there is no separate prototype branch.
Yunmin Workbench's domain model, Projection Truth, IPC, runtime, and
persistence contracts remain its own.

## DeepSeek-Reasonix

- Repository: https://github.com/esengine/DeepSeek-Reasonix
- Tag: `studio-v2.7.0`
- Commit: `9b7a573ac3a94b0a2313480181374464978e5ae9`
- License: MIT
- Copyright: Copyright (c) 2026 Reasonix Contributors
- Upstream files reviewed:
  - `desktop/frontend-next/src/ui/Graph.tsx`
  - `desktop/frontend-next/src/ui/glayout.ts`
  - `desktop/frontend-next/src/ui/Queue.tsx`
  - `desktop/frontend-next/src/ui/Rail.tsx`
  - `desktop/frontend-next/src/ui/Chrome.tsx`
  - `desktop/frontend-next/src/ui/Composer.tsx`
  - `desktop/frontend-next/src/ui/Pane.tsx`
  - `desktop/frontend-next/src/ui/PaneTabs.tsx`
  - `desktop/frontend-next/src/ui/Gutter.tsx`
  - `desktop/frontend-next/src/ui/Memory.tsx`
  - `desktop/frontend-next/src/styles/tokens.css`
  - `desktop/frontend-next/src/styles/app.css`
- Incorporated/adapted code:
  - deterministic rank placement and median crossing minimisation from
    `glayout.ts`, adapted in
    `src/renderer/src/views/reasonixProjectionLayout.ts`
  - pane/chrome/composer/on-demand-panel interaction structure, rewritten
    against existing Yunmin renderer state
- Not incorporated: Reasonix branding, colour tokens, fonts, kernel port,
  queue/memory mutation APIs, or runtime schema.

MIT License

Copyright (c) 2026 Reasonix Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Cockpit

- Repository: https://github.com/Surething-io/cockpit
- Commit: `f0328f4420217e41e5b4d710e5caa142faaa865b`
- License: MIT
- Copyright: Copyright (c) 2025 Robert
- Upstream files reviewed:
  - `packages/feature/agent/src/client/MessageBubble.tsx`
  - `packages/feature/agent/src/client/MessageList.tsx`
  - `packages/feature/agent/src/client/ToolCallModal.tsx`
  - `packages/feature/agent/src/client/ChatPanel.tsx`
- Adapted interaction pattern: assistant text, tool activity, and file changes
  remain in one chronological surface; tool details are quieter and expandable.
  Yunmin's implementation renders its existing `ActivityEvent` objects and
  does not incorporate Cockpit's runtime, file preview, or snapshot APIs.

MIT License

Copyright (c) 2025 Robert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## cdesktop

- Repository: https://github.com/cdesktop-ai/cdesktop
- Commit: `75bd015e88f9797d785c9fabcfca03c7151fd5cc`
- License: Apache License 2.0
- NOTICE: Copyright 2026 cdesktop contributors; cdesktop identifies itself as
  a derivative of `vibe-kanban` and also attributes provider catalog content
  to `cc-switch`.
- Upstream files reviewed:
  - `packages/web-core/src/features/workspace-chat/ui/ConversationListContainer.tsx`
  - `packages/web-core/src/features/workspace-chat/ui/DisplayConversationEntry.tsx`
  - `packages/web-core/src/features/workspace-chat/ui/SessionChatBoxContainer.tsx`
  - `packages/web-core/src/pages/workspaces/WorkspacesLayout.tsx`
  - `packages/web-core/src/pages/workspaces/WorkspacesSidebarContainer.tsx`
  - `packages/web-core/src/pages/workspaces/RightSidebar.tsx`
  - `packages/web-core/src/shared/components/NormalizedConversation/EditDiffRenderer.tsx`
  - `packages/web-core/src/shared/components/NormalizedConversation/FileChangeRenderer.tsx`
  - `packages/web-core/src/shared/components/NormalizedConversation/PendingApprovalEntry.tsx`
- Reference only: no cdesktop source code is incorporated in this repository.
  Its permanent 300px sidebar, session-grid stores, right-panel persistence,
  diff dependency, and approval APIs were deliberately not imported.
