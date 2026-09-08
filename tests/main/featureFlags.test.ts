import { afterEach, describe, expect, it } from 'vitest';
import { isVNextRendererEnabled, rendererEntryForEnvironment } from '../../src/main/featureFlags';

describe('isVNextRendererEnabled', () => {
  const original = process.env.WB_RENDERER_VNEXT;

  const clear = () => {
    delete process.env.WB_RENDERER_VNEXT;
  };

  afterEach(() => {
    if (original === undefined) clear();
    else process.env.WB_RENDERER_VNEXT = original;
  });

  it('returns false when the flag is unset (legacy default)', () => {
    clear();
    expect(isVNextRendererEnabled()).toBe(false);
  });

  it('returns true only when the flag is the literal "1"', () => {
    process.env.WB_RENDERER_VNEXT = '1';
    expect(isVNextRendererEnabled()).toBe(true);
  });

  it('rejects truthy-looking values that are not the literal "1"', () => {
    for (const value of ['true', 'yes', 'on', 'enabled', '0', '2', ' ']) {
      process.env.WB_RENDERER_VNEXT = value;
      expect(isVNextRendererEnabled(), `value=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('routes the main window to vNext only for the literal flag', () => {
    expect(rendererEntryForEnvironment({ WB_RENDERER_VNEXT: '1' })).toBe('../renderer-vnext/index.html');
    expect(rendererEntryForEnvironment({})).toBe('../renderer/index.html');
    expect(rendererEntryForEnvironment({ WB_RENDERER_VNEXT: 'true' })).toBe('../renderer/index.html');
  });
});
