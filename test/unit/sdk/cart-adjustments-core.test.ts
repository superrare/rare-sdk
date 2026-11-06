import { describe, expect, it } from 'vitest';
import { planCartAdjustmentCreate, planCartAdjustmentAssignmentCreate, parseCartAdjustment, parseCartAdjustmentAssignment, planCartAdjustmentList, cartAdjustmentRequestHeaders, type CartAdjustmentCreateParams } from '../../../src/sdk/cart-adjustments-core.js';
const input: CartAdjustmentCreateParams = {
 effect: 'CHARGE', phase: 'LISTING_CONFIGURATION', code: 'GALLERY_COMMISSION',
 calculation: {type: 'FIXED', amount: 12345678901234567890n, currencyMode: 'COMPONENT_CURRENCY'},
 recipient: {type: 'FIXED', address: '0x1111111111111111111111111111111111111111'},
};
describe('Cart adjustment definitions and assignments', () => {
 it('preserves bigint money separately from assignment scope', () => {
  const plan = planCartAdjustmentCreate(input); if (!plan.ok) throw new Error(plan.message);
  expect(plan.value.calculation).toMatchObject({amount: '12345678901234567890'});
  expect(plan.value).not.toHaveProperty('scope');
  expect(parseCartAdjustment({...plan.value, id: '1', chargeSku: `0x${'ab'.repeat(32)}`}).calculation).toMatchObject({amount: 12345678901234567890n});
  const assignment = planCartAdjustmentAssignmentCreate({adjustmentId: '1', priority: 100, scope: {nfts: [{chainId: 11155111, contract: '0x1111111111111111111111111111111111111111', tokenId: 9007199254740993n}]}});
  if (!assignment.ok) throw new Error(assignment.message);
  expect(assignment.value.scope.nfts?.[0]).toMatchObject({chainId: '11155111', tokenId: '9007199254740993'});
  expect(parseCartAdjustmentAssignment({...assignment.value, id: '2'}).scope.nfts?.[0]?.tokenId).toBe(9007199254740993n);
 });
 it('allows zero-percent waivers and rejects negative charges and invalid windows', () => {
  expect(planCartAdjustmentCreate({...input, calculation: {type: 'PERCENTAGE', basisPoints: 0, currencyMode: 'COMPONENT_CURRENCY'}}).ok).toBe(true);
  expect(planCartAdjustmentCreate({...input, calculation: {type: 'FIXED', amount: -1n, currencyMode: 'COMPONENT_CURRENCY'}}).ok).toBe(false);
  expect(planCartAdjustmentAssignmentCreate({adjustmentId: '1', priority: 10, scope: {}, validFrom: '2026-11-02T00:00:00Z', validUntil: '2026-11-01T00:00:00Z'}).ok).toBe(false);
  expect(() => parseCartAdjustment({...input, effect: 'DISCOUNT', id: '1', chargeSku: `0x${'ab'.repeat(32)}`})).toThrow();
  expect(() => planCartAdjustmentList({perPage: 101})).toThrow();
 });
 it('only supplies the internal credential when explicitly requested', () => {
  expect(cartAdjustmentRequestHeaders()).toEqual({});
  expect(cartAdjustmentRequestHeaders({internalApiKey: 'internal-secret'})).toEqual({'X-Authorization': 'Bearer internal-secret'});
  expect(() => cartAdjustmentRequestHeaders({internalApiKey: ''})).toThrow();
  expect(() => cartAdjustmentRequestHeaders({internalApiKey: 'key\r\nheader'})).toThrow();
 });
});
