import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export interface WindowStateV1 {
  schemaVersion: 1;
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const WindowStateSchema = z.object({
  schemaVersion: z.literal(1),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(640).max(10_000),
  height: z.number().int().min(480).max(10_000),
  maximized: z.boolean(),
}).strict();

export function normalizeWindowState(
  state: WindowStateV1 | null,
  workArea: { x: number; y: number; width: number; height: number },
): WindowStateV1 {
  const width = Math.min(Math.max(state?.width ?? 1440, 900), workArea.width);
  const height = Math.min(Math.max(state?.height ?? 900, 640), workArea.height);
  const requestedX = state?.x ?? workArea.x + Math.floor((workArea.width - width) / 2);
  const requestedY = state?.y ?? workArea.y + Math.floor((workArea.height - height) / 2);
  return {
    schemaVersion: 1,
    x: Math.min(Math.max(requestedX, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(requestedY, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
    maximized: state?.maximized ?? false,
  };
}

function pathFor(stateRoot: string): string {
  return join(stateRoot, 'window-state-v1.json');
}

export async function readWindowState(stateRoot: string): Promise<WindowStateV1 | null> {
  try {
    return WindowStateSchema.parse(JSON.parse(await readFile(pathFor(stateRoot), 'utf8')));
  } catch {
    return null;
  }
}

export async function writeWindowStateAtomic(stateRoot: string, state: WindowStateV1): Promise<void> {
  const parsed = WindowStateSchema.parse(state);
  const file = pathFor(stateRoot);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
