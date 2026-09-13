import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CurrentSelectionSchema,
  normalizeCurrentSelection,
  type CurrentSelectionV1,
} from '../core/compact/snapshot';

/**
 * Local UI bookmark for "what the user is working on". Written ONLY by an
 * explicit Full-Workbench Work/Task selection; read by the Compact surface.
 * Deliberately tiny: not Governance, not a WorkGraph SOT, not Task state.
 */

function selectionPath(stateRoot: string): string {
  return join(stateRoot, 'current-selection-v1.json');
}

export async function readCurrentSelection(stateRoot: string): Promise<CurrentSelectionV1 | null> {
  try {
    return normalizeCurrentSelection(JSON.parse(await readFile(selectionPath(stateRoot), 'utf8')));
  } catch {
    return null;
  }
}

/** Same-directory temp + rename: readers never observe partial JSON. */
export async function writeCurrentSelectionAtomic(
  stateRoot: string,
  selection: CurrentSelectionV1,
): Promise<void> {
  const parsed = CurrentSelectionSchema.parse(selection);
  const file = selectionPath(stateRoot);
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
