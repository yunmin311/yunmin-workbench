function textParts(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => textParts(item));
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text.trim() ? [record.text.trim()] : [];
  if ('content' in record) return textParts(record.content);
  if ('message' in record) return textParts(record.message);
  return [];
}

export function protocolText(value: unknown): string | undefined {
  const parts = textParts(value);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

export function codexAgentContent(item: Record<string, unknown>): string | undefined {
  return protocolText(item.text ?? item.content ?? item.message);
}

function nestedPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'filePath']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return nestedPath(record.input);
}

export function eventEvidence(value: Record<string, unknown>): { content: string; evidenceRef: string } | undefined {
  const path = nestedPath(value);
  const id = typeof value.id === 'string' ? value.id : undefined;
  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'fileChange') {
    if (!path) return undefined;
    return { content: path, evidenceRef: `file:${id ?? path}` };
  }
  const name = typeof value.name === 'string' ? value.name : type || 'Tool';
  if (!id && !name) return undefined;
  return { content: path ? `${name} · ${path}` : name, evidenceRef: `tool:${id ?? name}` };
}

export function packetTaskSummary(packetText: string): string | undefined {
  const match = /(?:^|\n)# Task Summary\r?\n([\s\S]*?)(?=\r?\n\r?\n# Context(?:\r?\n|$))/.exec(packetText);
  const summary = match?.[1]?.trim();
  return summary || undefined;
}
