# Product Rebuild — Adoption Map

- `App.tsx` chrome → Reasonix `AppChrome.tsx`: adapt its narrow titlebar, session tabs, and single command entry.
- `SessionSurface.tsx` composer → Reasonix `Composer.tsx`: adapt draft/running state, context cards, file/workspace/session references, long-paste capture, keyboard behavior, and agent selector.
- Attention gates → Reasonix `ApprovalModal.tsx`: adapt its focused prompt shelf for real approval/input events.
- `CommandPalette.tsx` → Reasonix `CommandPalette.tsx`: copy and adapt caller-supplied grouped items, wrapped keyboard navigation, focus, and dismissal.
- Canvas/trajectory → dsh-synapse `app.js`, `client.js`, `styles.css`: adapt real source-linked relations, selected-result follow-up, and native session/map synchronization. Coordinates remain presentation only.
- Runtime detail → Agent Cockpit `InstancePopupHub.tsx`: adapt the contextual Approvals / Chat / Timeline / Diff / Memory / Artifacts grouping; no pixel-office UI and no source copy without a confirmed license.

All Single, Parallel, Handoff, Compare, and Demo actions use one `Context → Packet → validate → dispatch → receipt → Activity/Runtime` controller. Demo differs only through an explicit demo environment resolved to a scoped deterministic adapter.
