import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from '@playwright/test';
import { encodeStateKey } from '../src/main/stateKey';
import { launchWorkbench, openSessionPacket, useOverlayFixture } from './prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME, FIXTURE_PROJECT_ID } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;

interface DialogueEntry {
  project?: string;
  platform?: string;
  role?: string;
}

function creativeOsConversationKeys(): { projectId: string; conversationKeys: string[] } | null {
  const instancesDir = join(OVERLAY, 'profiles', 'machines', 'instances');
  if (!existsSync(instancesDir)) return null;
  for (const name of readdirSync(instancesDir)) {
    if (!name.endsWith('-dialogues.yaml')) continue;
    const doc = load(readFileSync(join(instancesDir, name), 'utf8')) as { dialogues?: DialogueEntry[] } | null;
    const dialogues = (doc?.dialogues ?? []).filter(
      (d) => d.project === FIXTURE_PROJECT_ID && d.platform && d.role,
    );
    if (dialogues.length > 0) {
      return {
        projectId: FIXTURE_PROJECT_ID,
        conversationKeys: dialogues.map((d) => `${d.project}::${d.platform}::${d.role}`),
      };
    }
  }
  return null;
}

function seedFrozen(projectId: string, conversationKey: string, version: number, taskSummary: string, hashSeed: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    packetId: `seed-${version}`,
    createdAt: '2026-08-26T00:00:00.000Z',
    projectId,
    conversationKey,
    taskSummary,
    governanceRefs: [],
    included: [],
    references: [],
    sourceFingerprints: [],
    unresolvedDependencies: [],
    roughTokens: 10,
    frozenAt: '2026-08-26T00:00:00.000Z',
    hash: hashSeed.repeat(64).slice(0, 64),
    version,
  }, null, 2);
}

function seedEveryConversation(projectId: string, conversationKeys: string[], files: (convDir: string, conversationKey: string) => void): string {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-e2e-corrupt-'));
  for (const conversationKey of conversationKeys) {
    const convDir = join(
      stateDir,
      'state',
      'frozen-packets',
      encodeStateKey(projectId),
      encodeStateKey(conversationKey),
    );
    mkdirSync(convDir, { recursive: true });
    files(convDir, conversationKey);
  }
  return stateDir;
}

function listJsonFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) out.push(full);
    }
  };
  walk(root);
  return out;
}

test.describe('frozen corruption containment', () => {
  test('a corrupt frozen file never blanks the app and never hides valid history', async () => {
    const identity = creativeOsConversationKeys();
    test.skip(!identity, `no ${FIXTURE_PROJECT_ID} conversation in the overlay dialogue registry`);
    const { projectId, conversationKeys } = identity!;
    const stateDir = seedEveryConversation(projectId, conversationKeys, (convDir, conversationKey) => {
      writeFileSync(join(convDir, 'v1-aaaaaaaa.json'), seedFrozen(projectId, conversationKey, 1, 'surviving version', 'a'), 'utf8');
      writeFileSync(join(convDir, 'v2-broken.json'), '{"schemaVersion":1,"packetI', 'utf8');
      writeFileSync(join(convDir, 'v3-fake.json'), JSON.stringify({ version: 3, hash: 'zz', taskSummary: 'fake' }), 'utf8');
    });

    const { app, win } = await launchWorkbench(stateDir, OVERLAY);

    await openSessionPacket(win, FIXTURE_PROJECT_DISPLAY_NAME);

    const row = win.locator('.frozen-row').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('v1');
    await expect(win.locator('.frozen-row')).toHaveCount(1);

    await row.locator('.frozen-toggle').click();
    await expect(win.locator('.frozen-detail .source')).toContainText('surviving version');

    await app.close();
  });

  test('freezing still works after corruption and never overwrites the broken file', async () => {
    const identity = creativeOsConversationKeys();
    test.skip(!identity, `no ${FIXTURE_PROJECT_ID} conversation in the overlay dialogue registry`);
    const { projectId, conversationKeys } = identity!;
    const stateDir = seedEveryConversation(projectId, conversationKeys, (convDir) => {
      writeFileSync(join(convDir, 'v9-corrupt.json'), '{not json', 'utf8');
    });

    const { app, win } = await launchWorkbench(stateDir, OVERLAY);

    await openSessionPacket(win, FIXTURE_PROJECT_DISPLAY_NAME);

    await win.locator('.inspector-pane textarea').fill('Corruption recovery freeze');
    await expect(win.locator('.inspector-pane .validity-current')).toBeVisible();
    await win.locator('button.primary', { hasText: 'Freeze Current Task Packet' }).click();
    await expect(win.locator('p.ok')).toContainText('v1');

    const packetsRoot = join(stateDir, 'state', 'frozen-packets', encodeStateKey(projectId));
    const newFreezes = listJsonFilesRecursive(packetsRoot).filter((f) => !basename(f).includes('corrupt'));
    expect(newFreezes.length).toBeGreaterThanOrEqual(1);
    for (const file of newFreezes) {
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
    }
    for (const conversationKey of conversationKeys) {
      const broken = join(packetsRoot, encodeStateKey(conversationKey), 'v9-corrupt.json');
      if (existsSync(broken)) {
        expect(readFileSync(broken, 'utf8')).toBe('{not json');
      }
    }
    await app.close();
  });
});
