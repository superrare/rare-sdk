import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../../src/sdk/client.js';
import { createMemoryAccountSessionStore } from '../../../src/sdk/account-session-store.js';
import type { CartAdjustmentCreateParams, CartAdjustmentRequestOptions } from '../../../src/sdk/cart-adjustments-core.js';
const required = (name: string): string => {
 const value = process.env[name]; if (value === undefined || value === '') throw new Error(`${name} is required for adjustment administration integration coverage.`); return value;
};
const client = async (token?: string) => {
 const apiBaseUrl = required('RARE_API_BASE_URL').replace(/\/$/, '');
 const sessionStore = createMemoryAccountSessionStore();
 if (token !== undefined) await sessionStore.set({revision: randomBytes(16).toString('hex'), apiBaseUrl, authBaseUrl: `${apiBaseUrl}/auth/v2`, clientId: 'rare-sdk', accessToken: token, refreshToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + 300000, scope: 'rare:account offline_access'});
 return createRareClient({publicClient: createPublicClient({chain: sepolia, transport: http()}), apiBaseUrl, sessionStore});
};
const input: CartAdjustmentCreateParams = {effect: 'CHARGE', phase: 'LISTING_CONFIGURATION', code: 'GALLERY_COMMISSION', calculation: {type: 'PERCENTAGE', basisPoints: 3000, currencyMode: 'COMPONENT_CURRENCY'}, recipient: {type: 'FIXED', address: '0x1111111111111111111111111111111111111111'}};
const verify = async (admin: Awaited<ReturnType<typeof client>>, options?: CartAdjustmentRequestOptions): Promise<void> => {
 const created = await admin.cart.adjustments.create(input, options);
 expect(created.effect).toBe('CHARGE');
 const assignments = await Promise.all([1,2].map(async () => admin.cart.adjustments.assignments.create({adjustmentId: created.id, scope: {skus: [`0x${randomBytes(32).toString('hex')}`]}, priority: 200}, options)));
 try {
  const page = await admin.cart.adjustments.assignments.list({adjustmentId: created.id, perPage: 100}, options);
  expect(page.data.map(value => value.id).sort()).toEqual(assignments.map(value => value.id).sort());
  expect(page.data.every(value => value.adjustmentId === created.id)).toBe(true);
 } finally { await Promise.all(assignments.map(value => admin.cart.adjustments.assignments.disable(value.id, options))); }
 expect((await admin.cart.adjustments.assignments.list({adjustmentId: created.id}, options)).data).toHaveLength(0);
 // Disabling all assignments must retain the reusable definition.
 expect((await admin.cart.adjustments.list({perPage: 100}, options)).data.some(value => value.id === created.id)).toBe(true);
};
describe('SDK adjustment administration against a real Rare API', () => {
 it('reuses a definition through an administrator session and rejects non-admin access', async () => {
  await verify(await client(required('RARE_API_AUTH_TOKEN')));
  const other = await client(required('RARE_API_NON_ADMIN_AUTH_TOKEN'));
  await expect(other.cart.adjustments.list()).rejects.toThrow();
  await expect(other.cart.adjustments.create(input)).rejects.toThrow();
 }, 60000);
 it('supports the internal key without creating an account session', async () => {
  const admin = await client();
  await verify(admin, {internalApiKey: required('GQL_API_KEY')});
  await expect(admin.cart.adjustments.list({}, {internalApiKey: 'wrong-key'})).rejects.toThrow();
 }, 60000);
});
