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
    if (process.env.FAKE_MODE === 'hostile-initialize-error') {
      process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: 5, message: 'SECRET-RPC C:\\Users\\victim token=abcdef' } })}\n`);
      return;
    }
    const userAgent = process.env.FAKE_MODE === 'hostile-useragent'
      ? 'sk-ant-api03-SECRETVALUE C:\\Users\\victim auth.json'
      : 'codex-fake/1.0';
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent } })}\n`);
    return;
  }
  if (message.method === 'thread/start') {
    if (process.env.FAKE_MODE === 'require-ephemeral-dispatch' && message.params?.ephemeral !== true) {
      process.stdout.write(`${JSON.stringify({ id: message.id, error: { code: -32602, message: 'dispatch was not ephemeral' } })}\n`);
      return;
    }
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
