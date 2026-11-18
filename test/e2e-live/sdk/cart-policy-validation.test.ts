import { beforeAll, describe, expect, it } from 'vitest';
import { decodeAbiParameters, decodeErrorResult, encodeAbiParameters, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem';
import { cartAbi, cartLensAbi, getCartAddress, getCartLensAddress } from '../../../dist/sdk/contracts.js';
import { normalizeCartRouterProgram } from '../../../src/sdk/cart-router-program-core.js';
import captured from '../../fixtures/cart-provider-sepolia.json';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() ? describe.sequential : describe.skip;
const policyAbi = parseAbi([
  'function validateFor(address cart,bytes commands,bytes[] inputs) view returns(address[])',
  'error InvalidRouteRecipient(uint256 commandIndex,address recipient)',
]);
const router: Address = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
const payment: Record<'v3' | 'v4', Address> = {
  v3: '0x197FaeF3f59eC80113e773Bb6206a17d183F97CB',
  v4: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
};

describeLive('SDK Cart validation against the deployed Sepolia policy', () => {
  const client = hasTestRpcUrl() ? createTestSepoliaPublicClient() : undefined;
  const cart = getCartAddress('sepolia');
  const lens = getCartLensAddress('sepolia')!;

  beforeAll(async () => {
    expect(await client!.getChainId()).toBe(11155111);
  });

  it.each(['v3', 'v4'] as const)('accepts raw and SDK-normalized captured %s programs with identical endpoint assets', async kind => {
    const policy = await client!.readContract({ address: cart, abi: cartAbi, functionName: 'routePolicy' });
    const raw = { commands: captured[kind].commands as Hex, inputs: captured[kind].inputs as Hex[] };
    const normalized = normalizeCartRouterProgram(raw, cart, router, payment[kind]);
    const [rawAssets, normalizedAssets, rawPreview, normalizedPreview] = await Promise.all([
      client!.readContract({ address: policy, abi: policyAbi, functionName: 'validateFor', args: [cart, raw.commands, raw.inputs] }),
      client!.readContract({ address: policy, abi: policyAbi, functionName: 'validateFor', args: [cart, normalized.commands, normalized.inputs] }),
      client!.readContract({ address: lens, abi: cartLensAbi, functionName: 'previewRoute', args: [cart, { ...raw, routerValue: 0n }] }),
      client!.readContract({ address: lens, abi: cartLensAbi, functionName: 'previewRoute', args: [cart, { ...normalized, routerValue: 0n }] }),
    ]);
    expect(normalizedAssets).toEqual(rawAssets);
    expect(rawPreview.valid).toBe(true);
    expect(normalizedPreview.valid).toBe(true);
  });

  it.each(['0x0000000000000000000000000000000000005001', '0x0000000000000000000000000000000000000002'] as const)(
    'rejects V4 TAKE to final destination %s in both SDK and deployed Lens', async target => {
      const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), captured.v4.inputs[0] as Hex);
      const [currency, , amount] = decodeAbiParameters(parseAbiParameters('address,address,uint256'), params[2]!);
      const take = encodeAbiParameters(parseAbiParameters('address,address,uint256'), [currency, target, amount]);
      const badInput = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, [params[0]!, params[1]!, take]]);
      const bad = { commands: '0x10' as const, inputs: [badInput] };
      expect(() => normalizeCartRouterProgram(bad, cart, router, payment.v4)).toThrow('MSG_SENDER');
      const preview = await client!.readContract({ address: lens, abi: cartLensAbi, functionName: 'previewRoute', args: [cart, { ...bad, routerValue: 0n }] });
      expect(preview.valid).toBe(false);
      expect(decodeErrorResult({ abi: policyAbi, data: preview.reason }).errorName).toBe('InvalidRouteRecipient');
    },
  );
});
