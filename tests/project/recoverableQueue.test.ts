import { describe, expect, it } from 'vitest';
import { RecoverableSerialQueue } from '../../src/main/recoverableSerialQueue';

describe('RecoverableSerialQueue', () => {
  it('reports one mutation failure without poisoning later writes or idle barriers', async () => {
    const queue = new RecoverableSerialQueue();
    const order: string[] = [];
    await expect(queue.run(async () => { order.push('failed'); throw new Error('disk full'); })).rejects.toThrow('disk full');
    await expect(queue.run(async () => { order.push('recovered'); return 42; })).resolves.toBe(42);
    await expect(queue.idle()).resolves.toBeUndefined();
    expect(order).toEqual(['failed', 'recovered']);
  });

  it('survives consecutive failures and still serializes later work', async () => {
    const queue = new RecoverableSerialQueue();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(queue.run(async () => { throw new Error(`boom-${attempt}`); })).rejects.toThrow(`boom-${attempt}`);
    }
    await expect(queue.run(async () => 'alive')).resolves.toBe('alive');
    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it('never lets two mutations overlap, including after a rejected one', async () => {
    const queue = new RecoverableSerialQueue();
    let inFlight = 0;
    let peak = 0;
    const step = async (result: 'ok' | 'fail') => queue.run(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (result === 'fail') throw new Error('rejected mutation');
      return 'ok';
    });
    await expect(step('fail')).rejects.toThrow('rejected mutation');
    await Promise.all([step('ok'), step('ok'), step('ok')]);
    await queue.idle();
    expect(peak).toBe(1);
    expect(inFlight).toBe(0);
  });

  it('resolves idle only after queued work settles, and never rejects on failure', async () => {
    const queue = new RecoverableSerialQueue();
    let done = false;
    const first = queue.run(async () => { throw new Error('nope'); }).catch(() => 'handled');
    const second = queue.run(async () => { done = true; });
    await expect(queue.idle()).resolves.toBeUndefined();
    expect(done).toBe(true);
    await expect(first).resolves.toBe('handled');
    await second;
  });
});
