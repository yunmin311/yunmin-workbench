import { afterEach, describe, expect, it } from 'vitest';
import { isLegacyRendererEnabled, rendererEntryForEnvironment } from '../../src/main/featureFlags';

describe('renderer rollout (vNext default, legacy opt-in)', () => {
  const original = process.env.WB_RENDERER_LEGACY;

  const clear = () => {
    delete process.env.WB_RENDERER_LEGACY;
  };

  afterEach(() => {
    if (original === undefined) clear();
    else process.env.WB_RENDERER_LEGACY = original;
  });

  it('opens vNext when nothing is set (normal launch default)', () => {
    clear();
    expect(isLegacyRendererEnabled()).toBe(false);
  });

  it('opts into the legacy fallback only for the literal "1"', () => {
    process.env.WB_RENDERER_LEGACY = '1';
    expect(isLegacyRendererEnabled()).toBe(true);
  });

  it('rejects truthy-looking values that are not the literal "1"', () => {
    for (const value of ['true', 'yes', 'on', 'enabled', '0', '2', ' ']) {
      process.env.WB_RENDERER_LEGACY = value;
      expect(isLegacyRendererEnabled(), `value=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('ignores the retired WB_RENDERER_VNEXT flag: only legacy opt-in matters', () => {
    expect(rendererEntryForEnvironment({ WB_RENDERER_VNEXT: '1' } as never)).toBe('../renderer-vnext/index.html');
    expect(rendererEntryForEnvironment({})).toBe('../renderer-vnext/index.html');
    expect(rendererEntryForEnvironment({ WB_RENDERER_VNEXT: 'true' } as never)).toBe('../renderer-vnext/index.html');
    expect(rendererEntryForEnvironment({ WB_RENDERER_LEGACY: '1' })).toBe('../renderer/index.html');
  });
});
