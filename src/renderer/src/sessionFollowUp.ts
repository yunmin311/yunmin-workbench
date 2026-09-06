/**
 * Selected-text follow-up, directly observed in dsh-synapse
 * (liangmianya/dsh-synapse README, "追问更顺手": selected answer text can be
 * carried directly into a new follow-up). Workbench shape: a transient cue
 * above the composer; the quote is prepended to the existing draft, which is
 * preserved. No new permanent surface, no transcript mutation.
 */

const MAX_QUOTE = 400;
const MIN_QUOTE = 3;

export function selectionToFollowUpCue(selection: string | null | undefined): string | null {
  if (!selection) return null;
  const trimmed = selection.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_QUOTE) return null;
  return trimmed.slice(0, MAX_QUOTE);
}

export function followUpDraftFromSelection(currentDraft: string, selection: string): string {
  const quote = selectionToFollowUpCue(selection);
  if (!quote) return currentDraft;
  const quoted = `> ${quote}`;
  const retained = currentDraft.trim();
  return retained ? `${quoted}\n\n${retained}` : `${quoted}\n\n`;
}
