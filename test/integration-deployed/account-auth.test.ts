import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

describe('account integration with deployed services', () => {
  it('logs in with a wallet, reuses the account, updates its profile, refreshes and revokes', async () => {
    const apiBaseUrl = required('RARE_ACCOUNT_TEST_API_URL').replace(/\/$/u, '');
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash ||
        url.username || url.password || url.hostname === 'api.superrare.com') {
      throw new Error('RARE_ACCOUNT_TEST_API_URL must be a non-production HTTPS API origin');
    }
    const privateKey = required('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) throw new Error('Invalid dedicated test wallet key');
    const wallet = privateKeyToAccount(privateKey as `0x${string}`);
    const first = createRareAccountClient({ apiBaseUrl });
    const second = createRareAccountClient({ apiBaseUrl });
    const login = (client: typeof first) => client.auth.loginWithWallet({
      address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }),
    });
    try {
      const unauthenticated = await fetch(`${apiBaseUrl}/v1/me`, { signal: AbortSignal.timeout(15_000) });
      expect(unauthenticated.status).toBe(401);

      await login(first);
      const initial = await first.profile.get();
      expect(initial.address.toLowerCase()).toBe(wallet.address.toLowerCase());
      expect(initial.accountId).toMatch(/^[1-9]\d*$/u);

      await first.profile.update({ profile: { fullName: 'Rare SDK integration', bio: 'Deployed account test' } });
      await login(second);
      const reused = await second.profile.get();
      expect(reused.accountId).toBe(initial.accountId);
      expect(reused.profile).toMatchObject({ fullName: 'Rare SDK integration', bio: 'Deployed account test' });

      await second.profile.update({ profile: { fullName: 'Rare SDK integration updated' } });
      expect((await first.profile.get()).profile).toMatchObject({
        fullName: 'Rare SDK integration updated', bio: 'Deployed account test',
      });

      const before = await first.auth.getSession();
      expect(before).not.toBeNull();
      const refreshed = await first.auth.refresh();
      expect(refreshed.refreshToken).not.toBe(before?.refreshToken);
      await first.auth.logout();
      const revoked = await fetch(`${apiBaseUrl}/v1/me`, {
        headers: { authorization: `Bearer ${refreshed.accessToken}` }, signal: AbortSignal.timeout(15_000),
      });
      expect(revoked.status).toBe(401);
      expect((await second.profile.get()).accountId).toBe(initial.accountId);
    } finally {
      for (const client of [first, second]) {
        if (await client.auth.getSession()) await client.auth.logout();
      }
    }
  }, 120_000);
});
