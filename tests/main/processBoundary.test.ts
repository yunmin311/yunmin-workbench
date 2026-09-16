import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('child process substrate boundary', () => {
  it('keeps OpenCode process ownership inside the shared substrate', async () => {
    const source = await readFile(resolve('src/main/adapters/openCodeAdapter.ts'), 'utf8');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).not.toContain('taskkill');
    expect(source).toContain("from '../process/processRunner'");
  });

  it('keeps Claude process ownership inside the shared substrate', async () => {
    const source = await readFile(resolve('src/main/adapters/claudeCodeAdapter.ts'), 'utf8');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).not.toContain('taskkill');
    expect(source).toContain("from '../process/processRunner'");
  });

  it('keeps Codex app-server process ownership inside the shared substrate', async () => {
    const source = await readFile(resolve('src/main/adapters/codexAppServer.ts'), 'utf8');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).toContain("from '../process/processRunner'");
  });

  it('keeps DeepSeek process ownership inside the shared substrate', async () => {
    const source = await readFile(resolve('src/main/adapters/deepseekAdapter.ts'), 'utf8');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).toContain("from '../process/processRunner'");
  });

  it('keeps main-process version probes inside the shared substrate', async () => {
    const source = await readFile(resolve('src/main/index.ts'), 'utf8');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).toContain("from './process/processRunner'");
  });
});
