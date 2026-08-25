import type { InboxItem } from '../types';

const OPEN_RE = /^- \[ \]\s*(.*)$/;
const DONE_RE = /^- \[x\]\s*(.*)$/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const OWNER_RE = /·\s*([^·\s]+)\s*·/;
const SECTION_RE = /^#{2,3}\s+(.+)$/;
const ATTENTION_SECTION_RE = /待办|needs.?attention|open/i;
const ATTENTION_MARK_RE = /needs-user|blocked|resume-later|等你|需要你/i;

/**
 * Parse overlay INBOX.md checkbox items.
 * INBOX is a reminder projection, NOT the task canonical source (PDF §3) —
 * we keep line numbers + sourceRef so the UI can jump back to the canonical file.
 */
export function parseInbox(markdown: string, sourceRef = 'INBOX.md'): InboxItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: InboxItem[] = [];
  let inAttentionSection = false;
  lines.forEach((text, idx) => {
    const section = text.match(SECTION_RE);
    if (section) {
      inAttentionSection = ATTENTION_SECTION_RE.test(section[1]);
      return;
    }
    const open = text.match(OPEN_RE);
    const done = text.match(DONE_RE);
    const body = open?.[1] ?? done?.[1];
    if (body === undefined) return;
    items.push({
      id: `inbox:${idx + 1}`,
      raw: body.trim(),
      done: Boolean(done),
      date: body.match(DATE_RE)?.[1],
      owner: body.match(OWNER_RE)?.[1],
      attention: Boolean(open) && (inAttentionSection || ATTENTION_MARK_RE.test(body)),
      line: idx + 1,
      sourceRef: `${sourceRef}#L${idx + 1}`,
    });
  });
  return items;
}
