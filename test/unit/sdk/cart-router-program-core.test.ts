import { describe, expect, it } from 'vitest';
import captured from '../../fixtures/cart-provider-sepolia.json';
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
  it('accepts the captured V4 SETTLE/TAKE route while preserving swap bounds and payer flags', () => {
    const target: Address = '0xACfF2622f53f360274df3014DC135EfDC058786B';
    const exchange: Address = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
    const program = normalizeCartRouterProgram({ commands: captured.v4.commands as Hex, inputs: captured.v4.inputs as Hex[] }, target, exchange, token);
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), program.inputs[0]!);
    const [, original] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), captured.v4.inputs[0] as Hex);
    expect(actions).toBe('0x090b0e');
    expect(params[0]).toBe(original[0]);
    expect(params[1]).toBe(original[1]);
    const [currency, , amount] = decodeAbiParameters(parseAbiParameters('address,address,uint256'), original[2]!);
    expect(decodeAbiParameters(parseAbiParameters('address,address,uint256'), params[2]!)).toEqual([currency, sender, amount]);
    expect(program.commands).toBe(captured.v4.commands);
  });
  it('accepts the captured V3 router-custody/unwrap route without dropping the unwrap', () => {
    const target: Address = '0xACfF2622f53f360274df3014DC135EfDC058786B';
    const exchange: Address = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
    const program = normalizeCartRouterProgram({ commands: captured.v3.commands as Hex, inputs: captured.v3.inputs as Hex[] }, target, exchange, token);
    expect(program.commands).toBe('0x010c04');
    expect(program.inputs[0]).toBe(captured.v3.inputs[0]);
    const [, amount] = decodeAbiParameters(parseAbiParameters('address,uint256'), captured.v3.inputs[1] as Hex);
    expect(decodeAbiParameters(parseAbiParameters('address,uint256'), program.inputs[1]!)).toEqual([sender, amount]);
  });
  it.each(['0x060d0f', '0x060c10', '0x060c0f00'] as const)('rejects unsupported V4 actions %s', actions => {
    const input = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, ['0x', '0x', '0x']]);
    expect(() => normalizeCartRouterProgram({ commands: '0x10', inputs: [input] }, cart, router, token)).toThrow('Unsupported V4');
  });
  it('accepts every supported V4 settlement form and preserves the payer flag and amount sentinels', () => {
    for (const swap of ['06', '07', '08', '09']) for (const settle of ['0b', '0c']) for (const take of ['0e', '0f']) {
      const actions = `0x${swap}${settle}${take}` as Hex;
      const payment = settle === '0b' ? encodeAbiParameters(parseAbiParameters('address,uint256,bool'), [token, 0n, false]) : encodeAbiParameters(parseAbiParameters('address,uint256'), [token, 123n]);
      const output = take === '0e' ? encodeAbiParameters(parseAbiParameters('address,address,uint256'), [other, cart, 0n]) : encodeAbiParameters(parseAbiParameters('address,uint256'), [other, 7n]);
      const encoded = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, ['0x', payment, output]]);
      const result = normalizeCartRouterProgram({ commands: '0x10', inputs: [encoded] }, cart, router, token);
      const [actualActions, parameters] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), result.inputs[0]!);
      expect(actualActions).toBe(actions);
      expect(parameters[1]).toBe(payment);
      if (take === '0e') expect(decodeAbiParameters(parseAbiParameters('address,address,uint256'), parameters[2]!)).toEqual([other, sender, 0n]);
      else expect(parameters[2]).toBe(output);
    }
  });
  it.each([other, router, routerAlias])('rejects V4 TAKE to final destination %s', target => {
    const parameters = ['0x', encodeAbiParameters(parseAbiParameters('address,uint256,bool'), [token, 0n, true]), encodeAbiParameters(parseAbiParameters('address,address,uint256'), [other, target, 0n])] as const;
    const input = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x080b0e', parameters]);
    expect(() => normalizeCartRouterProgram({ commands: '0x10', inputs: [input] }, cart, router, token)).toThrow('MSG_SENDER');
  });
  it.each(['0x00', '0x01', '0x08', '0x09'] as const)('allows temporary router custody for swap %s but rejects strangers', commands => {
    const parameters = commands === '0x00' || commands === '0x01' ? parseAbiParameters('address,uint256,uint256,bytes,bool') : parseAbiParameters('address,uint256,uint256,address[],bool');
    const path = commands === '0x00' || commands === '0x01' ? v3Path : [token, other];
    for (const [target, expected] of [[router, routerAlias], [routerAlias, routerAlias]] as const) {
      const encoded = encodeAbiParameters(parameters, [target, 7n, 9n, path, false]);
      const result = normalizeCartRouterProgram({ commands, inputs: [encoded] }, cart, router, token);
      expect(decodeAbiParameters(parameters, result.inputs[0]!)).toEqual([expected, 7n, 9n, path, false]);
    }
    expect(() => normalizeCartRouterProgram({ commands, inputs: [encodeAbiParameters(parameters, [other, 7n, 9n, path, false])] }, cart, router, token)).toThrow('MSG_SENDER');
  });
  it('rejects mismatched command/input counts and flagged commands', () => {
    expect(() => normalizeCartRouterProgram({ commands: '0x1004', inputs: ['0x'] }, cart, router, token)).toThrow('counts must match');
    expect(() => normalizeCartRouterProgram({ commands: '0x90', inputs: ['0x'] }, cart, router, token)).toThrow('Unsupported router command');
  });
  it('does not create refund-only routes or native funding for token payments', () => {
    expect(appendCartNativeRefund({ commands: '0x', inputs: [] }, zeroAddress)).toEqual({ commands: '0x', inputs: [] });
    const program: { commands: Hex; inputs: Hex[] } = { commands: '0x10', inputs: ['0x'] };
    expect(appendCartNativeRefund(program, token)).toBe(program);
  });
});
