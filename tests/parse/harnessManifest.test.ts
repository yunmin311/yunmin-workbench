import { describe, expect, it } from 'vitest';
import { parseHarnessManifest } from '../../src/core/parse/harnessManifest';

// Canonical v2 shape: hooks live under harness.<name>.hooks (the real
// ai-governance-system manifest), NOT at a top-level `hooks:` key.
const CANONICAL = `
generated_at: '2026-08-22'
harness:
  claude:
    install:
      - src: harness/claude/settings.desired.json
        dst: ~/.claude/settings.json
    hooks:
      - id: cross-project-deny
        event: PreToolUse
        enforcement: HARD
      - id: reuse-first-gate
        event: PreToolUse
        enforcement: SOFT
  codex:
    install:
      - src: harness/codex/global-AGENTS.md
        dst: ~/.codex/AGENTS.md
render:
  vars:
    PROJECT_ROOTS: { from: sibling-git-repos }
plugins:
  claude:
    - { name: a, enabled: true }
    - { name: b, enabled: false }
`;

// Legacy tolerated shape: top-level hooks.<name> list.
const LEGACY = `
hooks:
  claude:
    - id: html-design-redline
      event: PreToolUse
      enforcement: SOFT
render:
  claude:
    model: sonnet
`;

describe('parseHarnessManifest', () => {
  it('finds hooks under harness.<name>.hooks (canonical shape)', () => {
    const out = parseHarnessManifest(CANONICAL);
    const claude = out.find((h) => h.harness === 'claude')!;
    const codex = out.find((h) => h.harness === 'codex')!;
    expect(claude).toBeTruthy();
    expect(claude.hooks.map((x) => x.id)).toEqual(['cross-project-deny', 'reuse-first-gate']);
    expect(claude.hooks[0].enforcement).toBe('HARD');
    expect(codex).toBeTruthy();
    expect(codex.hooks).toHaveLength(0);
  });

  it('counts plugins per harness from the canonical shape', () => {
    const claude = parseHarnessManifest(CANONICAL).find((h) => h.harness === 'claude')!;
    expect(claude.pluginsEnabled).toBe(1);
  });

  it('still parses the legacy top-level hooks shape and render.model', () => {
    const out = parseHarnessManifest(LEGACY);
    const claude = out.find((h) => h.harness === 'claude')!;
    expect(claude.hooks.map((x) => x.id)).toEqual(['html-design-redline']);
    expect(claude.model).toBe('sonnet');
  });

  it('returns empty for empty yaml instead of throwing', () => {
    expect(parseHarnessManifest('')).toEqual([]);
  });
});
