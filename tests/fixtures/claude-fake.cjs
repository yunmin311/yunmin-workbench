const mode = process.env.FAKE_MODE || 'ok';
const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('2.1.207 (Claude Code)');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('Usage: claude [options] [command] [prompt]');
  console.log(mode === 'incompatible'
    ? '  --output-format <format>  Output format (choices: "text")'
    : '  --output-format <format>  Output format (choices: "text", "json", "stream-json")');
  process.exit(0);
}
const isDispatch = args.includes('-p') || args.some((a) => a.includes('claude-fake.cjs')) || (args.length > 0 && !args.includes('--version') && !args.includes('--help'));
if (isDispatch) {
  const text = args[args.length - 1] || '';
  const sessionId = `claude-session-${Date.now()}`;
  const cwd = process.cwd();

  const emit = (obj) => console.log(JSON.stringify(obj));

  if (mode === 'assert-safe-args') {
    const safe = args.includes('--no-session-persistence') && !args.includes('--dangerously-skip-permissions');
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    emit({ type: 'result', subtype: safe ? 'success' : 'error', session_id: sessionId, result: safe ? 'safe' : 'unsafe args', is_error: !safe });
    process.exit(safe ? 0 : 2);
    return;
  }

  // Simulate malformed event mode
  if (mode === 'malformed') {
    console.log('not json');
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd, not_closed: true }); // will be parsed as valid, but next line malformed
    console.log('{ truncated');
    process.stdout.write('', () => {
      if (mode === 'crash') process.exit(1);
      else {
        emit({ type: 'result', subtype: 'success', session_id: sessionId, result: 'ok', is_error: false });
        process.exit(0);
      }
    });
    return;
  }
  if (mode === 'crash') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    setTimeout(() => process.exit(1), 20);
    return;
  }
  if (mode === 'partial') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    process.stdout.write('{"type":"assistant"');
    process.exit(0);
    return;
  }
  if (mode === 'malformed-result') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    emit({ type: 'result', session_id: sessionId });
    process.exit(0);
    return;
  }
  if (mode === 'hang') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    setInterval(() => undefined, 1000);
    return;
  }
  if (mode === 'no-session-id') {
    // No session_id in init — tests real identity must not guess from cwd
    emit({ type: 'system', subtype: 'init', cwd });
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${text}` }] } });
    emit({ type: 'result', subtype: 'success', result: `echo: ${text}`, is_error: false });
    process.exit(0);
    return;
  }
  if (mode === 'approval') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    // Claude approval is not via stream-json approval id, we simulate tool that would require permission
    // For now, emit a tool_use that would be OBSERVED, not approval — ensure not faked
    emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }] } });
    emit({ type: 'result', subtype: 'success', session_id: sessionId, result: 'done', is_error: false });
    process.exit(0);
    return;
  }
  if (mode === 'tool') {
    emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
    emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 'tool-2', name: 'Edit', input: { file_path: 'external.txt' } }] } });
    emit({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'updated', is_error: false }] } });
    emit({ type: 'result', subtype: 'success', session_id: sessionId, result: 'done', is_error: false });
    process.exit(0);
    return;
  }

  // Normal ok
  emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: `Claude response to: ${text}` }] } });
  emit({ type: 'result', subtype: 'success', session_id: sessionId, result: `Claude result for ${text}`, is_error: false });
  setTimeout(() => process.exit(0), 40);
  return;
}
console.log('claude-fake unknown args');
process.exit(0);
