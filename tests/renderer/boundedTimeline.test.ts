import { describe, expect, it } from 'vitest';
import { boundedTimeline, visibleCountForTarget } from '../../src/renderer/src/boundedTimeline';

describe('boundedTimeline', () => {
  const events = Array.from({ length: 500 }, (_, index) => ({ id: `event-${index}` }));

  it('keeps chronological order while showing only the newest bounded window', () => {
    expect(boundedTimeline(events, 200).map((event) => event.id)).toEqual(
      events.slice(300).map((event) => event.id),
    );
  });

  it('expands enough to reveal an exact older source without loading everything unnecessarily', () => {
    expect(visibleCountForTarget(events, 200, (event) => event.id === 'event-250')).toBe(250);
    expect(visibleCountForTarget(events, 200, (event) => event.id === 'missing')).toBe(200);
  });
});
