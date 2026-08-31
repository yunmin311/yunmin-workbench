import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MaterialUserPreferenceSchema } from '../core/material/tokens';
import type { MaterialUserPreference } from '../core/material/tokens';

export interface MaterialPreferenceV1 {
  schemaVersion: 1;
  material: MaterialUserPreference;
}

export const DEFAULT_MATERIAL_PREFERENCE: MaterialPreferenceV1 = {
  schemaVersion: 1,
  material: 'system',
};

function preferencePath(stateDir: string): string {
  return join(stateDir, 'material', 'material-v1.json');
}

export async function readMaterialPreference(stateDir: string): Promise<MaterialPreferenceV1> {
  try {
    const raw = JSON.parse(await readFile(preferencePath(stateDir), 'utf8')) as unknown;
    if (typeof raw === 'object' && raw !== null && 'material' in raw) {
      const parsed = MaterialUserPreferenceSchema.safeParse((raw as { material: unknown }).material);
      if (parsed.success && (raw as { schemaVersion?: unknown }).schemaVersion === 1) {
        return { schemaVersion: 1, material: parsed.data };
      }
    }
    // also support legacy direct enum storage
    const direct = MaterialUserPreferenceSchema.safeParse(raw);
    if (direct.success) return { schemaVersion: 1, material: direct.data };
    return { ...DEFAULT_MATERIAL_PREFERENCE };
  } catch {
    return { ...DEFAULT_MATERIAL_PREFERENCE };
  }
}

export async function writeMaterialPreferenceAtomic(
  stateDir: string,
  preference: MaterialPreferenceV1,
): Promise<void> {
  if (preference.schemaVersion !== 1) throw new Error('unsupported material schema');
  const parsed = MaterialUserPreferenceSchema.parse(preference.material);
  const toStore = { schemaVersion: 1, material: parsed };
  const target = preferencePath(stateDir);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(toStore, null, 2), 'utf8');
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
