import { describe, expect, it } from 'vitest';
import { __workbenchApiKeys } from '../../src/preload/index';
import {
  __workbenchContractV1Methods,
  type WorkbenchContractV1,
} from '../../src/preload/contract';

/**
 * PHASE 1 contract assertion: the live preload implementation in
 * `src/preload/index.ts` and the type-only contract in
 * `src/preload/contract.ts` describe the same method surface.
 *
 * If either side drifts (renamed, added, removed), this test fails before
 * any IPC call site notices.
 *
 * The runtime keys come from `__workbenchApiKeys` (preload implementation)
 * and `__workbenchContractV1Methods` (contract proxy). The proxy is type-
 * asserted as `WorkbenchContractV1`, so any missing method name in the
 * proxy will fail the typecheck in `contract.ts` rather than silently
 * slip through the test.
 */
describe('preload contract ↔ implementation', () => {
  it('exposes every WorkbenchContract method', () => {
    const contractKeys = Object.keys(__workbenchContractV1Methods);
    for (const key of contractKeys) {
      expect(__workbenchApiKeys, `missing method ${key} in preload implementation`).toContain(key);
    }
  });

  it('does not expose methods that the contract does not list', () => {
    const contractKeys = new Set(Object.keys(__workbenchContractV1Methods));
    for (const key of __workbenchApiKeys) {
      expect(contractKeys.has(key), `unexpected method ${key} in preload implementation`).toBe(true);
    }
  });

  it('keeps the same method count both ways', () => {
    const contractKeys = Object.keys(__workbenchContractV1Methods);
    expect(contractKeys.length).toBe(__workbenchApiKeys.length);
  });

  it('proxy shape stays in lockstep with WorkbenchContractV1 at type level', () => {
    type ProxyKeys = keyof typeof __workbenchContractV1Methods;
    type ContractKeys = keyof WorkbenchContractV1;
    const proxyKeys = '' as ProxyKeys;
    const contractKeys = '' as ContractKeys;
    // Both must agree on every member name.
    expect((proxyKeys satisfies ContractKeys) === (contractKeys satisfies ProxyKeys)).toBe(true);
  });
});