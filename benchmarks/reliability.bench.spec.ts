import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { encodeStateKey } from '../src/main/stateKey';
import { launchWorkbench, openSessionPacket, useOverlayFixture } from '../e2e/prototype-shell';
import { FIXTURE_PROJECT_DISPLAY_NAME } from '../tests/fixtures/overlayFixture';

const overlay = useOverlayFixture();
const OVERLAY = overlay.overlayRoot;

const PROJECT_ID = 'bench-proj';
const CONV_KEY = 'bench::codex::main';

function seedFrozenPacket(version: number, bodyBytes: number): string {
  const body = 'x'.repeat(Math.max(0, bodyBytes));
  const packet = {
    schemaVersion: 1,
    packetId: `bench-packet-${version}`,
    createdAt: '2026-08-26T00:00:00.000Z',
    projectId: PROJECT_ID,
    conversationKey: CONV_KEY,
    taskSummary: `bench v${version}`,
    governanceRefs: [],
    included: [
      {
        id: `ctx-${version}`,
        title: 'Bench context',
        source: 'manual',
        body,
        state: 'included',
        pinned: false,
        isReference: false,
      },
    ],
    references: [],
    sourceFingerprints: [],
    unresolvedDependencies: [],
    roughTokens: Math.ceil(body.length / 4),
  };
  const frozen = {
    ...packet,
    frozenAt: '2026-08-26T00:00:00.000Z',
    hash: 'a'.repeat(64),
    version,
  };
  return JSON.stringify(frozen, null, 2);
}

function seedStore(count: number, bodyBytes: number): string {
  const stateDir = mkdtempSync(join(tmpdir(), 'wb-bench-'));
  const convDir = join(
    stateDir,
    'state',
    'frozen-packets',
    encodeStateKey(PROJECT_ID),
    encodeStateKey(CONV_KEY),
  );
  mkdirSync(convDir, { recursive: true });
  for (let version = 1; version <= count; version += 1) {
    writeFileSync(join(convDir, `v${version}-${'a'.repeat(8)}.json`), seedFrozenPacket(version, bodyBytes), 'utf8');
  }
  return stateDir;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | `TIMEOUT:${string}`> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<`TIMEOUT:${string}`>((resolve) => {
    timer = setTimeout(() => resolve(`TIMEOUT:${label}`), ms);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer!);
  return result as T | `TIMEOUT:${string}`;
}

async function timeListFrozen(win: Page): Promise<{ coldMs: number | string; warmMs: number | string; payloadChars: number | string }> {
  const cold = await withTimeout(win.evaluate(async ([projectId, conversationKey]) => {
    const t0 = performance.now();
    const result = await window.wb.listFrozen(projectId, conversationKey);
    const packets = Array.isArray(result) ? result : result.packets;
    (window as unknown as { __benchPayloadChars?: number }).__benchPayloadChars = JSON.stringify(packets).length;
    return performance.now() - t0;
  }, [PROJECT_ID, CONV_KEY]), 30_000, 'coldList');
  const warm = await withTimeout(win.evaluate(async ([projectId, conversationKey]) => {
    await window.wb.listFrozen(projectId, conversationKey);
    const t0 = performance.now();
    await window.wb.listFrozen(projectId, conversationKey);
    return performance.now() - t0;
  }, [PROJECT_ID, CONV_KEY]), 30_000, 'warmList');
  const payloadChars = await win.evaluate(() => (window as unknown as { __benchPayloadChars?: number }).__benchPayloadChars ?? -1);
  return { coldMs: cold, warmMs: warm, payloadChars };
}

const benchResults: Record<string, unknown> = {};
const label = process.env.BENCH_LABEL ?? 'unnamed';

test.describe('reliability gate benchmarks', () => {
  test.skip(!process.env.WB_BENCH, 'benchmark run only');

  test('listFrozen scaling + cold start + packet interaction', async () => {
    for (const count of [50, 300, 600]) {
      const stateDir = seedStore(count, 20_000);
      const launchStart = Date.now();
      const { app, win } = await launchWorkbench(stateDir, OVERLAY);
      const brand = await withTimeout(expect(win.locator('.prototype-chrome')).toBeVisible().then(() => 'ok'), 20_000, 'chrome');
      const coldStartMs = brand === 'ok' ? Date.now() - launchStart : String(brand);
      const { coldMs, warmMs, payloadChars } = await timeListFrozen(win);
      benchResults[`list_${count}`] = { coldStartMs, coldListIpcMs: coldMs, warmListIpcMs: warmMs, payloadChars, files: count };
      console.log(`BENCH[${label}] list_${count}: ${JSON.stringify(benchResults[`list_${count}`])}`);
      await app.close();
    }

    {
      const stateDir = seedStore(300, 20_000);
      const { app, win } = await launchWorkbench(stateDir, OVERLAY);
      await openSessionPacket(win, FIXTURE_PROJECT_DISPLAY_NAME);
      await win.waitForTimeout(1500);

      const heapAfterListKb = await win.evaluate(() => {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return memory ? Math.round(memory.usedJSHeapSize / 1024) : null;
      });
      const typing = await withTimeout(win.evaluate(() => new Promise<number>((resolve) => {
        const ta = document.querySelector('textarea');
        if (!ta) {
          resolve(-1);
          return;
        }
        let received = 0;
        const t0 = performance.now();
        const onInput = () => {
          received += 1;
          if (received === 25) {
            ta.removeEventListener('input', onInput);
            resolve(performance.now() - t0);
          }
        };
        ta.addEventListener('input', onInput);
        let sent = 0;
        const step = () => {
          ta.value += '字';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          sent += 1;
          if (sent < 25) setTimeout(step, 16);
        };
        setTimeout(step, 16);
      })), 30_000, 'typing');

      benchResults.packet_300 = { typing25CharsMs: typing, heapAfterListKb };
      await app.close();
    }

    console.log(`BENCH[${label}] FINAL ${JSON.stringify(benchResults)}`);
  }, 240_000);
});
