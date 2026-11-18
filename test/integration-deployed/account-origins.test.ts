import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

const configuration = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL?.replace(/\/$/u, '');
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!apiBaseUrl || new URL(apiBaseUrl).protocol !== 'https:' || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Use RARE_ACCOUNT_TEST_API_URL with a non-production HTTPS deployment');
  if (!key || !/^0x[0-9a-f]{64}$/iu.test(key)) throw new Error('Set the existing dedicated RARE_ACCOUNT_TEST_PRIVATE_KEY');
  return { apiBaseUrl, wallet: privateKeyToAccount(key as `0x${string}`) };
};

// These exercise real HTTP origin admission. Browser enforcement is verified separately.
const browserOriginFetch = (origin: string): typeof fetch => (input, init = {}) => fetch(input, {
  ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: origin },
});

describe('deployed third-party wallet authentication', () => {
  it('rejects matching browser and signing origins when the domain is unapproved', async () => {
    const { apiBaseUrl, wallet } = configuration();
    const origin = `https://sdk-${randomUUID()}.example`;
    const client = createRareClient({ apiBaseUrl, apiFetch: browserOriginFetch(origin) });
    await expect(client.auth.loginWithWallet({
      address: wallet.address, chainId: 1, signingOrigin: origin,
      signMessage: async () => { throw new Error('An unapproved origin must be rejected before wallet signing'); },
    })).rejects.toMatchObject({ code: 'access_denied', status: 403 });
    expect(await client.auth.getSession()).toBeNull();
    await expect(client.profile.get()).rejects.toMatchObject({ code: 'authentication_required' });
  }, 120_000);

  it('rejects a browser requesting a challenge for a different signing origin', async () => {
    const { apiBaseUrl, wallet } = configuration();
    const response = await browserOriginFetch(`https://sdk-${randomUUID()}.example`)(`${apiBaseUrl}/auth/v2/wallet/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'rare-sdk', address: wallet.address, chain_id: 1, origin: `https://different-${randomUUID()}.example` }),
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.status).toBe(403);
    const value = await response.json() as Record<string, unknown>;
    expect(value).not.toHaveProperty('message');
    expect(value).not.toHaveProperty('access_token');
  });
});
