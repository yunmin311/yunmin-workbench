import React, { useEffect, useState } from 'react';
import type { AttentionItem } from '../../core/types';
import { AmbientItem } from './AmbientItem';

interface AmbientSnapshot {
  visible: boolean;
  count: number;
  highestLevel?: AttentionItem['level'];
  items: AttentionItem[];
}

export function AmbientIsland(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AmbientSnapshot>({ visible: false, count: 0, items: [] });
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const unsubscribe = window.island.onSnapshot((data: unknown) => {
      const parsed = data as AmbientSnapshot;
      setSnapshot(parsed);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.island.onExpanded((exp: unknown) => {
      const parsed = exp as boolean;
      setExpanded(parsed);
    });
    return unsubscribe;
  }, []);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (expanded) return;
    setIsDragging(true);
    setDragOffset({ x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) return;
      const dx = event.screenX - dragOffset.x;
      const dy = event.screenY - dragOffset.y;
      setDragOffset({ x: event.screenX, y: event.screenY });
      const w = window as unknown as { electron?: { moveWindow?: (a: number, b: number) => void } };
      w.electron?.moveWindow?.(dx, dy);
    };

    const handleMouseUp = () => {
      if (isDragging) setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  if (!snapshot.visible) {
    return <div style={{ width: '100%', height: '100%' }} />;
  }

  const levelColors: Record<AttentionItem['level'], string> = {
    alert: 'rgba(220, 38, 38, 0.9)',
    action: 'rgba(245, 158, 11, 0.9)',
    review: 'rgba(59, 130, 246, 0.9)',
  };

  const levelBorders: Record<AttentionItem['level'], string> = {
    alert: 'rgba(220, 38, 38, 1)',
    action: 'rgba(245, 158, 11, 1)',
    review: 'rgba(59, 130, 246, 1)',
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: expanded ? 'rgba(30, 30, 30, 0.95)' : 'rgba(30, 30, 30, 0.9)',
        borderRadius: expanded ? 12 : 8,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${levelBorders[snapshot.highestLevel ?? 'review']}`,
        borderLeft: `3px solid ${levelColors[snapshot.highestLevel ?? 'review']}`,
        overflow: 'hidden',
        cursor: expanded ? 'default' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          padding: expanded ? '12px' : '8px',
          borderBottom: expanded ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: levelColors[snapshot.highestLevel ?? 'review'],
              boxShadow: `0 0 8px ${levelColors[snapshot.highestLevel ?? 'review']}`,
            }}
          />
          <span
            style={{
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: expanded ? 13 : 11,
              fontWeight: 500,
            }}
          >
            {snapshot.count === 1 ? '1 attention' : `${snapshot.count} attentions`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void window.island.toggleExpansion().then((result: unknown) => {
              const parsed = result as { expanded: boolean };
              setExpanded(parsed.expanded);
            });
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            fontSize: 16,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      {expanded && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {snapshot.items.map((item) => (
            <AmbientItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}