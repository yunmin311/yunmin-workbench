const readline = require('node:readline');

let threads = 0;
let dying = false;

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex-fake/1.0' } })}\n`);
    return;
  }
  if (message.method === 'thread/start') {
    threads += 1;
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: `fake-thread-${threads}` } } })}\n`);
    if (process.env.FAKE_MODE === 'die-after-thread-start') {
      dying = true;
      setTimeout(() => process.exit(0), 40);
    }
    return;
  }
  if (dying) return;
  if (message.method === 'turn/start') {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { turn: { id: `fake-turn-${message.params?.threadId ?? 'x'}` } } })}\n`);
    if (process.env.FAKE_MODE === 'die-after-turn-start') {
      setTimeout(() => process.exit(0), 30);
    }
    if (process.env.FAKE_MODE === 'server-requests') {
      process.stdout.write(`${JSON.stringify({
        method: 'item/commandExecution/requestApproval',
        id: 'approval-1',
        params: { threadId: message.params?.threadId, turnId: 'fake-turn', itemId: 'item-1', reason: 'network' },
      })}\n`);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
});
