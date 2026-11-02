import { describe, expect, it } from 'vitest';
import { zeroAddress, type Hex } from 'viem';
import { validateCartPrintSelections } from '../../../src/sdk/cart-print-selections-core.js';
import type { CartCheckoutIntent, CartPrintMintSelection } from '../../../src/sdk/types/cart-api.js';

const preparationId = '11111111-1111-4111-8111-111111111111';
const listingDigest: Hex = `0x${'ab'.repeat(32)}`;
function intent(mintSelections: CartPrintMintSelection[]): CartCheckoutIntent {
  return { paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest, quantity: 2n }],
    delivery: { savedAddressId: preparationId, mintSelections } };
}
describe('physical selections paired with mint results', () => {
  it('preserves ordered multi-copy assignments without predicting token IDs', () => {
    expect(validateCartPrintSelections(intent([{ preparationId, listingDigest, unitIndexes: [1, 0] }]))).toEqual([]);
  });
  it('rejects repeated units, absent sources and indexes beyond purchased quantity', () => {
    for (const unitIndexes of [[0, 0], [2], [-1], [0.5], []]) {
      expect(validateCartPrintSelections(intent([{ preparationId, listingDigest, unitIndexes }])).length).toBeGreaterThan(0);
    }
    expect(validateCartPrintSelections(intent([{ preparationId, listingDigest: `0x${'cd'.repeat(32)}`, unitIndexes: [0] }]))[0]?.code).toBe('invalid_mint_source');
    expect(validateCartPrintSelections(intent([
      { preparationId, listingDigest, unitIndexes: [0] },
      { preparationId: '22222222-2222-4222-8222-222222222222', listingDigest, unitIndexes: [0] },
    ]))[0]?.code).toBe('duplicate_mint_unit');
  });
});
