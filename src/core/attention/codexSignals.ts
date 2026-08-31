/** A completed file-change is review-worthy only when the protocol confirms success. */
export function isReviewWorthyCodexFileChange(
  method: string,
  item: { type?: unknown; status?: unknown },
): boolean {
  return method === 'item/completed'
    && item.type === 'fileChange'
    && item.status === 'completed';
}
