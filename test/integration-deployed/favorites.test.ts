import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient, type RareAccountClient } from '../../src/sdk/index.js';
import { createRareApi } from '../../src/sdk/api.js';
import { normalizeFavoriteId } from '../../src/sdk/favorites-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const wallet = (name: string) => {
  const key = required(name);
  if (!isPrivateKeyString(key)) throw new Error(`Invalid dedicated test key ${name}`);
  return privateKeyToAccount(key);
};
const login = async (client: RareAccountClient, owner: ReturnType<typeof wallet>): Promise<void> => {
  await client.auth.loginWithWallet({ address: owner.address, chainId: 1, signMessage: message => owner.signMessage({ message }) });
};
describe('artwork favorites against deployed services', () => {
  it('keeps favorites private, exposes only aggregate counts, and applies writes only to the signed-in account', async () => {
    const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
    if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Use a non-production HTTPS API origin');
    const id = normalizeFavoriteId(required('RARE_ACCOUNT_TEST_ARTWORK_ID'));
    const owner = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherOwner = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(owner.address.toLowerCase()).not.toBe(otherOwner.address.toLowerCase());
    const account = createRareAccountClient({ apiBaseUrl: url.origin });
    const other = createRareAccountClient({ apiBaseUrl: url.origin });
    const api = createRareApi({ baseUrl: url.origin });
    const resource = `/v1/me/favorites/${id}`;
    const call = (path: string, method = 'GET', token?: string) => fetch(`${url.origin}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
    const beforeCount = await api.getNftFavoriteCount(id);
    const absentId = `1-${privateKeyToAccount(generatePrivateKey()).address.toLowerCase()}-9223372036854775807`;
    await expect(api.getNftFavoriteCount(absentId)).rejects.toMatchObject({ status: 404 });
    for (const token of [undefined, 'forged']) {
      expect((await call('/v1/me/favorites', 'GET', token)).status).toBe(401);
      for (const method of ['GET', 'PUT', 'DELETE']) expect((await call(resource, method, token)).status).toBe(401);
    }
    try {
      await login(account, owner);
      await login(other, otherOwner);
      await expect(account.favorites.add(absentId)).rejects.toMatchObject({ status: 404 });
      const before = await account.favorites.list();
      const otherBefore = await other.favorites.list();
      expect(await account.favorites.has(id)).toBe(false);
      expect(await other.favorites.has(id)).toBe(false);
      try {
        const writes = await Promise.allSettled([account.favorites.add(id), account.favorites.add(id)]);
        for (const result of writes) if (result.status === 'rejected') throw result.reason;
        await account.favorites.add(id);
        expect(await account.favorites.has(id)).toBe(true);
        expect(await other.favorites.has(id)).toBe(false);
        const list = await account.favorites.list({ perPage: 1 });
        expect(list.pagination.totalCount).toBe(before.pagination.totalCount + 1);
        expect(list.data).toHaveLength(1);
        expect(list.data[0]?.universalTokenId).toBe(id);
        expect(JSON.stringify(list)).not.toContain('email');
        expect(await api.getNftFavoriteCount(id)).toBe(beforeCount + 1);
        const count = await call(`/v1/nfts/${id}/favorites/count`);
        expect(await count.json()).toEqual({ data: { count: beforeCount + 1 } });
        expect((await call(`/v1/nfts/${id}/favorites`)).status).toBe(404);
        expect((await call(`/v1/users/${otherOwner.address}/favorites`)).status).toBe(404);
        const session = await account.auth.getSession();
        if (!session) throw new Error('Missing session');
        const otherProfile = await other.profile.get();
        for (const query of [`userId=${otherProfile.accountId}`, `address=${otherOwner.address}`, `username=${otherProfile.username}`]) {
          expect((await call(`/v1/me/favorites?${query}`, 'GET', session.accessToken)).status).toBe(400);
          expect((await call(`${resource}?${query}`, 'DELETE', session.accessToken)).status).toBe(400);
        }
        const privateResponse = await call('/v1/me/favorites', 'GET', session.accessToken);
        expect(privateResponse.headers.get('cache-control')).toContain('no-store');
        expect(await other.favorites.list()).toEqual(otherBefore);
        await account.favorites.remove(id);
        await account.favorites.remove(id);
        expect(await account.favorites.has(id)).toBe(false);
        expect(await account.favorites.list()).toEqual(before);
        expect(await api.getNftFavoriteCount(id)).toBe(beforeCount);
      } finally {
        await account.favorites.remove(id);
      }
    } finally {
      await Promise.all([account.auth.logout(), other.auth.logout()]);
    }
  }, 240_000);
});
