import React from 'react';
import type { AttentionItem } from '../../core/types';

interface AmbientItemProps {
  item: AttentionItem;
}

const kindLabels: Record<AttentionItem['kind'], string> = {
  'approval-required': 'Approval',
  'needs-user-input': 'Input',
  'receipt-failed': 'Failed',
  'runtime-error': 'Error',
  'packet-stale': 'Stale',
  'packet-invalid': 'Invalid',
  'gate-attention': 'Gate',
  'execution-review': 'Review',
};

const levelColors: Record<AttentionItem['level'], string> = {
  alert: 'rgba(220, 38, 38, 0.8)',
  action: 'rgba(245, 158, 11, 0.8)',
  review: 'rgba(59, 130, 246, 0.8)',
};

const levelBorders: Record<AttentionItem['level'], string> = {
  alert: 'rgba(220, 38, 38, 0.5)',
  action: 'rgba(245, 158, 11, 0.5)',
  review: 'rgba(59, 130, 246, 0.5)',
};

export function AmbientItem({ item }: AmbientItemProps): React.JSX.Element {
  const handleClick = () => {
    const w = window as unknown as { electron?: { openSource?: (t: unknown) => void } };
    w.electron?.openSource?.({
      projectId: item.projectId,
      conversationKey: item.conversationKey,
      sessionRef: item.sessionRef,
      sourceRef: item.sourceRef,
      eventRef: item.eventRef,
    });
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    const w = window as unknown as { island?: { dismissAttention?: (a: string, b: string) => Promise<void> } };
    void w.island?.dismissAttention?.(item.id, item.observedAt);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 10,
        marginBottom: 6,
        background: 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${levelBorders[item.level]}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
        e.currentTarget.style.borderColor = levelColors[item.level];
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
        e.currentTarget.style.borderColor = levelBorders[item.level];
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {kindLabels[item.kind]} · {item.level}
        </span>
        <span
          style={{
            color: 'rgba(255, 255, 255, 0.4)',
            fontSize: 10,
          }}
        >
          {item.verification}
        </span>
      </div>
      <strong
        style={{
          color: 'rgba(255, 255, 255, 0.95)',
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        {item.title}
      </strong>
      <span
        style={{
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: 11,
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {item.summary}
      </span>
      {(item.projectId || item.sessionRef) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {item.projectId && (
            <span
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: 10,
              }}
            >
              {item.projectId}
            </span>
          )}
          {item.sessionRef && (
            <span
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: 10,
              }}
            >
              {item.sessionRef}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss this observation"
        style={{
          marginTop: 6,
          alignSelf: 'flex-start',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.7)',
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: 10,
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </button>
  );
}