export const TIMELINE_PAGE_SIZE = 200;

export function boundedTimeline<T>(items: readonly T[], visibleCount: number): T[] {
  return items.slice(Math.max(0, items.length - Math.max(0, visibleCount)));
}

export function visibleCountForTarget<T>(
  items: readonly T[],
  currentCount: number,
  matches: (item: T) => boolean,
): number {
  const index = items.findIndex(matches);
  return index < 0 ? currentCount : Math.max(currentCount, items.length - index);
}
