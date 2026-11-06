import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, encodeAbiParameters, encodePacked, parseAbiParameters, zeroAddress, type Address, type Hex } from 'viem';
import { appendCartNativeRefund, normalizeCartRouterProgram } from '../../../src/sdk/cart-router-program-core.js';

const cart: Address = '0x0000000000000000000000000000000000000010';
const router: Address = '0x0000000000000000000000000000000000000020';
const sender: Address = '0x0000000000000000000000000000000000000001';
const routerAlias: Address = '0x0000000000000000000000000000000000000002';
const token: Address = '0x0000000000000000000000000000000000000030';
const other: Address = '0x0000000000000000000000000000000000000040';
const v3Path = encodePacked(['address', 'uint24', 'address'], [token, 3000, other]);

describe('Cart provider router program normalization', () => {
  it.each(['0x00', '0x01'] as const)('uses MSG_SENDER for V3 %s without changing bounds or the path', commands => {
    const parameters = parseAbiParameters('address,uint256,uint256,bytes,bool');
    const input = encodeAbiParameters(parameters, [cart, 123n, 456n, v3Path, true]);
    const program = normalizeCartRouterProgram({ commands, inputs: [input] }, cart, router, token);
    expect(program.commands).toBe(commands);
    expect(decodeAbiParameters(parameters, program.inputs[0]!)).toEqual([sender, 123n, 456n, v3Path, true]);
  });
  it.each(['0x08', '0x09'] as const)('uses MSG_SENDER for V2 %s without changing bounds or the path', commands => {
    const parameters = parseAbiParameters('address,uint256,uint256,address[],bool');
    const input = encodeAbiParameters(parameters, [cart, 123n, 456n, [token, other], true]);
    const program = normalizeCartRouterProgram({ commands, inputs: [input] }, cart, router, token);
    expect(decodeAbiParameters(parameters, program.inputs[0]!)).toEqual([sender, 123n, 456n, [token, other], true]);
  });
  it('prefunds only the router alias through Permit2', () => {
    const parameters = parseAbiParameters('address,address,uint160');
    const input = encodeAbiParameters(parameters, [token, router, 123n]);
    const program = normalizeCartRouterProgram({ commands: '0x02', inputs: [input] }, cart, router, token);
    expect(decodeAbiParameters(parameters, program.inputs[0]!)).toEqual([token, routerAlias, 123n]);
    expect(() => normalizeCartRouterProgram({ commands: '0x02', inputs: [encodeAbiParameters(parameters, [token, cart, 123n])] }, cart, router, token))
      .toThrow('Permit2 must prefund');
  });
  it.each(['0x0b', '0x0c'] as const)('keeps router intermediates and Cart outputs for %s', commands => {
    const parameters = parseAbiParameters('address,uint256');
    for (const [target, expected] of [[cart, sender], [router, routerAlias], [sender, sender], [routerAlias, routerAlias]] as const) {
      const program = normalizeCartRouterProgram({ commands, inputs: [encodeAbiParameters(parameters, [target, 9n])] }, cart, router, token);
      expect(decodeAbiParameters(parameters, program.inputs[0]!)).toEqual([expected, 9n]);
    }
  });
  it('keeps token sweeps separate and rejects unrelated recipients', () => {
    const parameters = parseAbiParameters('address,address,uint256');
    const program = normalizeCartRouterProgram({ commands: '0x04', inputs: [encodeAbiParameters(parameters, [token, cart, 7n])] }, cart, router, token);
    expect(decodeAbiParameters(parameters, program.inputs[0]!)).toEqual([token, sender, 7n]);
    expect(() => normalizeCartRouterProgram({ commands: '0x04', inputs: [encodeAbiParameters(parameters, [token, other, 7n])] }, cart, router, token))
      .toThrow('MSG_SENDER');
    expect(() => normalizeCartRouterProgram({ commands: '0x04', inputs: [encodeAbiParameters(parameters, [zeroAddress, cart, 7n])] }, cart, router, zeroAddress))
      .toThrow('refund minimum');
  });
  it.each(['0x060b0f', '0x060c0e', '0x060c0f00'] as const)('rejects unsupported V4 actions %s', actions => {
    const input = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, ['0x', '0x', '0x']]);
    expect(() => normalizeCartRouterProgram({ commands: '0x10', inputs: [input] }, cart, router, token)).toThrow('Unsupported V4');
  });
  it('does not create refund-only routes or native funding for token payments', () => {
    expect(appendCartNativeRefund({ commands: '0x', inputs: [] }, zeroAddress)).toEqual({ commands: '0x', inputs: [] });
    const program: { commands: Hex; inputs: Hex[] } = { commands: '0x10', inputs: ['0x'] };
    expect(appendCartNativeRefund(program, token)).toBe(program);
  });
});
