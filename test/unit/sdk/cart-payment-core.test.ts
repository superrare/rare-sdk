import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import { planCartPayment } from '../../../src/sdk/cart-payment-core.js';
import type { CartCheckoutPreparation } from '../../../src/sdk/types/cart-api.js';

const preparation: CartCheckoutPreparation = {
  schemaVersion: 1, chainId: 11155111n, cartAddress: zeroAddress, preparedAt: '2026-11-02T00:00:00Z', expiresAt: '2026-11-02T01:00:00Z',
  preparationReference: '11111111-1111-4111-8111-111111111111', paymentAmount: 10n, fees: [], settlements: [], lines: [],
  route: { commands: '0x', inputs: [], routerValue: 0n },
  intent: { paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest: `0x${'11'.repeat(32)}`, quantity: 1n }] },
};
const scope = { chainId: '11155111', cartAddress: zeroAddress };
describe('payment selection for a prepared Cart checkout', () => {
  it('reuses a digital checkout reference without adding delivery details', () => {
    expect(planCartPayment({ method: 'card', preparation, email: 'buyer@example.com' }, scope)).toEqual({
      preparationReference: preparation.preparationReference, idempotencyKey: preparation.preparationReference, email: 'buyer@example.com',
    });
  });
  it('preserves a physical quote intent and its existing attempt identity', () => {
    const physical = { ...preparation, idempotencyKey: '22222222-2222-4222-8222-222222222222', intent: { ...preparation.intent, delivery: { savedAddressId: preparation.preparationReference } } };
    expect(planCartPayment({ method: 'card', preparation: physical, email: 'buyer@example.com' }, scope)).toMatchObject({
      idempotencyKey: physical.idempotencyKey, delivery: { ...physical.intent, idempotencyKey: physical.idempotencyKey },
    });
  });
  it('rejects cross-deployment preparations and malformed contact information before an API request', () => {
    expect(() => planCartPayment({ method: 'card', preparation: { ...preparation, chainId: 1n }, email: 'buyer@example.com' }, scope)).toThrow('another deployment');
    expect(() => planCartPayment({ method: 'card', preparation, email: 'invalid' }, scope)).toThrow();
  });
});
