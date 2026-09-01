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

## Reference-only donor registry

The following projects were reviewed for product or engineering ideas. No
source code, assets, runtime, protocol implementation, or UI implementation
from these entries is incorporated by that review. Their license
classifications remain recorded so future work cannot silently turn a
reference into copied code. Any future incorporation requires a new,
file-level provenance and license review.

| Project | License classification | Current status |
|---|---|---|
| `cookielab/klovi@dd4e06b8f52b95a4768302930ad73543b93cf54d` | MIT | reference only |
| `jhlee0409/claude-code-history-viewer@b5f583e5f97d8d768b49229c2eb5c0a5a2c39070` | MIT | reference only |
| `Ron537/DPlex@ad832206a593b983cfe30772c658aec67b8ce568` | MIT | reference only |
| `fairchild/workspaces@4b2c460c70871964f253dafcf617ad17aa668198` | Apache-2.0 | reference only |
| `mysqto/csx@08a8d1c66240b9417b759db754ffaa4c8aa10536` | MIT | reference only |
| `youdie006/sessionwiki@eef72642a80bed9d3b767b87c91d0137b9b25780` | MIT | reference only |
| `OlegHQ/agentpack@33f2223006406c3767d6ffa9fb34cc75114be209` | MIT | reference only |
| `lukaszraczylo/harness-sync@c5707acfd3ff25b8038de2ae03b366a117980b52` | MIT | reference only |
| `grimoire-rs/grimoire@4e57da1cde2f2f67a92943a13921fc5f4e477fde` | Apache-2.0 | reference only |
| `louis49/melchizedek@305361244239912684dd7f71c05a6a298c80776e` | MIT | reference only |
| `Nan0pk/Archiv@dd6ba02d50826e34895a284c5b9b24af75b01d4b` | Apache-2.0 | reference only |
| `geekmuse/chronicle@1b9044c757b7111d6b782b44a608a1ae63d9a9b8` | MIT | reference only |
| `milkoor/causetrace@c7fce56f58e21368e4454e5cd830c3a1afc9c262` | MIT | reference only |
| `phronesis-io/eigenflux@8d9679a7c89d9d87d5e580c610a4abebd541f296` | modified Apache / trademark terms | reference only; fresh review required before incorporation |
| `WYH66666666/DSH-Transparent-UI-Plugin@d94431a95bd147c11ef3fe95fa1915d1e96b028b` | AGPL-3.0 | visual reference only; no code copied |
| `xiaopu-ai/TO-DO-Panel@9db3a75743a1f5b15a0dacf37b9c87ea84dff548` | MIT | reference only |
| `xuxinle/gebai@47d92b873e96f53698eee15079fac73055205d92` | MIT | reference only |
| `diqierjia/StrataGate-AgentMemory@28e0906445a28c9cafe61cd46844b1395cdbfbf5` | MIT | reference only |

Previously frozen reference-only entries in the project's reuse map retain
their existing status; this notice does not broaden their approved use.

### dsh-synapse — future donor only

- Repository: https://github.com/liangmianya/dsh-synapse
- Reviewed commit: `56935dc1862e7791b212f6eb2dd26404def5a575`
- License: MIT
- Status: high-priority future donor for Conversation Canvas / Trajectory /
  DSH integration. No integration or copied implementation in this phase.
- Semantics retained for a future design review only:
  - DSH session logs remain the conversation and lifecycle source of truth.
  - Canvas metadata is organizational state, not lineage.
  - Native fork/session relations drive projection.
  - Live tool calls and results pair by `callId`.
  - Projection updates incrementally; visual coordinates never determine
    conversation truth.
