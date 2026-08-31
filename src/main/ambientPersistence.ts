import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AmbientIslandPreferenceSchema,
  DEFAULT_AMBIENT_PREFERENCE,
  type AmbientIslandPreferenceV1,
} from '../core/ambient/island';

function preferencePath(stateDir: string): string {
  return join(stateDir, 'ambient', 'island-v1.json');
}

export async function readAmbientPreference(stateDir: string): Promise<AmbientIslandPreferenceV1> {
  try {
    const parsed = AmbientIslandPreferenceSchema.safeParse(JSON.parse(await readFile(preferencePath(stateDir), 'utf8')));
    return parsed.success ? parsed.data : { ...DEFAULT_AMBIENT_PREFERENCE };
  } catch {
    return { ...DEFAULT_AMBIENT_PREFERENCE };
  }
}

export async function writeAmbientPreferenceAtomic(
  stateDir: string,
  preference: AmbientIslandPreferenceV1,
): Promise<void> {
  const parsed = AmbientIslandPreferenceSchema.parse(preference);
  const target = preferencePath(stateDir);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
