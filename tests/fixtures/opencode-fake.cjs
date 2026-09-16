const mode = process.env.FAKE_MODE || 'ok';
const args = process.argv.slice(2);

if (args.includes('--version')) {
  if (mode === 'missing-version') process.exit(127);
  console.log('1.18.26');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log(mode === 'incompatible'
    ? 'opencode run --format default'
    : 'opencode run --format json --session <sessionID>');
  process.exit(0);
}

if (args[0] === 'session' && args[1] === 'list') {
  console.log(JSON.stringify([
    {
      id: 'ses_native_history_1', slug: 'native-history', projectID: 'project-1',
      directory: process.cwd(), title: 'Native session', agent: 'build',
      model: { id: 'model-1', providerID: 'provider-1' }, version: '1.18.26',
      time: { created: 1000, updated: 2000 },
    },
  ]));
  process.exit(0);
}

if (args[0] === 'run') {
  const session = args.includes('--session')
    ? args[args.indexOf('--session') + 1]
    : `ses_native_${Date.now()}`;
  const emit = (value) => console.log(JSON.stringify(value));
  if (mode === 'malformed') console.log('not-json');
  if (mode !== 'no-session') emit({ type: 'step_start', sessionID: session, part: { id: 'prt_1', type: 'step-start' } });
  if (mode === 'hang') {
    setInterval(() => undefined, 1000);
    return;
  }
  if (mode === 'provider-limit') {
    emit({
      type: 'error', sessionID: session,
      error: { name: 'FreeUsageLimitError', data: { message: 'Too many requests for free-model. Retry later.' }, statusCode: 429 },
    });
    process.exit(1);
  }
  if (mode === 'tool') emit({
    type: 'tool_use', sessionID: session,
    part: { id: 'prt_tool', type: 'tool', tool: 'read', state: { status: 'completed', output: 'ok' } },
  });
  if (mode !== 'no-session') emit({ type: 'text', sessionID: session, part: { id: 'prt_text', type: 'text', text: 'OPEN_CODE_OK' } });
  if (mode !== 'partial' && mode !== 'no-session') emit({ type: 'step_finish', sessionID: session, part: { id: 'prt_2', type: 'step-finish' } });
  if (mode === 'finish-hang') return setInterval(() => {}, 1_000);
  process.exit(mode === 'crash' ? 2 : 0);
}
