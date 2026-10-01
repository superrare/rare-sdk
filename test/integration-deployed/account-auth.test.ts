import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareApi } from '../../src/sdk/api.js';

const retryRateLimit = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error === null || typeof error !== 'object' ||
        !('code' in error && error.code === 'slow_down') && !('status' in error && error.status === 429)) throw error;
    console.warn('[live integration] Rate limited; retrying once after 60 seconds.');
    await new Promise(resolve => setTimeout(resolve, 60_000));
    return operation();
  }
};

const loginWithWallet = (client: ReturnType<typeof createRareAccountClient>, input: Parameters<typeof client.auth.loginWithWallet>[0]) =>
  retryRateLimit(() => client.auth.loginWithWallet(input));

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const testWallet = (name: string) => {
  const key = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(key)) throw new Error('Invalid dedicated test wallet key');
  return privateKeyToAccount(key as `0x${string}`);
};

describe('account integration with deployed services', () => {
  it('does not expose email in public profile responses, including field-selection attempts', async () => {
    const api = required('RARE_ACCOUNT_TEST_API_URL');
    if (new URL(api).protocol !== 'https:' || new URL(api).hostname === 'api.superrare.com') throw new Error('Use a non-production HTTPS API');
    const address = '0xd87d6f5754295ae9fc3a101d1d65297e145acb8a';
    const assertPublic = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(assertPublic);
      else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          expect(key.toLowerCase()).not.toContain('email');
          assertPublic(child);
        }
      }
    };
    assertPublic(await createRareApi({ baseUrl: api }).getUser(address));
    for (const query of ['', '?fields=email&include=email&include_fields=email']) {
      const response = await fetch(`${api}/v1/users/${address}${query}`, { signal: AbortSignal.timeout(20_000) });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      assertPublic(body);
    }
  }, 240_000);
  it('authenticates a fresh wallet without creating an account, including after refresh', async () => {
    const apiBaseUrl = required('RARE_ACCOUNT_TEST_API_URL').replace(/\/$/u, '');
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com') throw new Error('Use a non-production HTTPS API');
    const wallet = privateKeyToAccount(generatePrivateKey());
    const client = createRareAccountClient({ apiBaseUrl });
    try {
      await loginWithWallet(client, { address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
      expect(await client.auth.getSession()).not.toBeNull();
      await expect(client.profile.get()).rejects.toMatchObject({ code: 'account_required', status: 403 });
      await expect(client.profile.update({ profile: { bio: 'No automatic signup' } })).rejects.toMatchObject({ code: 'account_required', status: 403 });
      await client.auth.refresh();
      await expect(client.profile.get()).rejects.toMatchObject({ code: 'account_required', status: 403 });
    } finally {
      await client.auth.logout();
    }
  }, 240_000);
  it('rejects reused wallet proofs and signatures from another wallet', async () => {
    const apiBaseUrl = required('RARE_ACCOUNT_TEST_API_URL').replace(/\/$/u, '');
    const origin = new URL(apiBaseUrl);
    if (origin.protocol !== 'https:' || origin.hostname === 'api.superrare.com') throw new Error('Use a non-production HTTPS API');
    const owner = testWallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const attacker = testWallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(attacker.address.toLowerCase()).not.toBe(owner.address.toLowerCase());
    const client = createRareAccountClient({ apiBaseUrl });
    const request = (path: string, init: RequestInit = {}) => retryRateLimit(async () => {
      const response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) throw { status: 429 };
      return response;
    });
    const form = (fields: Record<string, string>) => request('/auth/v2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
    });
    try {
      const challengeResponse = await request('/auth/v2/wallet/challenge', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: 'rare-sdk', address: owner.address, chain_id: 1, origin: apiBaseUrl }),
      });
      expect(challengeResponse.status).toBe(200);
      const challenge = await challengeResponse.json() as { challenge_id: string; message: string };
      const signedGrant = { grant_type: 'urn:superrare:params:oauth:grant-type:siwe', client_id: 'rare-sdk',
        challenge_id: challenge.challenge_id, message: challenge.message,
        signature: await owner.signMessage({ message: challenge.message }),
      };
      const issued = await form(signedGrant);
      expect(issued.status).toBe(200);
      const issuedBody = await issued.json() as { refresh_token: string };
      try {
        expect((await form(signedGrant)).status).toBe(400);
      } finally {
        const revoked = await request('/auth/v2/revoke', { method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: 'rare-sdk', token: issuedBody.refresh_token, token_type_hint: 'refresh_token' }),
        });
        expect(revoked.status).toBe(200);
      }
      await expect(loginWithWallet(client, { address: owner.address, chainId: 1,
        signMessage: message => attacker.signMessage({ message }),
      })).rejects.toThrow();
      expect(await client.auth.getSession()).toBeNull();
    } finally {
      await client.auth.logout().catch(() => undefined);
    }
  }, 240_000);
  it('rejects unauthorized profile access, privileged writes and cross-account selectors', async () => {
    const apiBaseUrl = required('RARE_ACCOUNT_TEST_API_URL').replace(/\/$/u, '');
    const origin = new URL(apiBaseUrl);
    if (origin.protocol !== 'https:' || origin.hostname === 'api.superrare.com') throw new Error('Use a non-production HTTPS API');
    const owner = testWallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const attacker = testWallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(attacker.address.toLowerCase()).not.toBe(owner.address.toLowerCase());
    const victim = createRareAccountClient({ apiBaseUrl });
    const client = createRareAccountClient({ apiBaseUrl });
    const request = (path: string, init: RequestInit = {}) => retryRateLimit(async () => {
      const response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) throw { status: 429 };
      return response;
    });
    try {
      for (const [account, wallet] of [[victim, owner], [client, attacker]] as const) {
        await loginWithWallet(account, { address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
      }
      const original = await victim.profile.get();
      const attackerProfile = await client.profile.get();
      const session = await client.auth.getSession();
      if (!session) throw new Error('Missing attacker session');
      const headers = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };
      const anonymousWrite = await request('/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: { bio: 'unauthorized' } }) });
      expect(anonymousWrite.status).toBe(401);
      const forged = await request('/v1/me', { headers: { authorization: 'Bearer forged' } });
      expect(forged.status).toBe(401);
      for (const body of [
        { accountId: original.accountId, profile: { bio: 'unauthorized' } },
        { address: owner.address, profile: { bio: 'unauthorized' } },
        { profile: { email: 'attacker@example.test', isCreator: true } },
      ]) {
        expect((await request('/v1/me', { method: 'PATCH', headers, body: JSON.stringify(body) })).status).toBe(400);
      }
      const selected = await request(`/v1/me?accountId=${original.accountId}&address=${owner.address}`, { headers });
      expect(selected.status).toBe(200);
      expect(selected.headers.get('cache-control')).toContain('no-store');
      const selectedBody = await selected.json() as { data: { accountId: string } };
      expect(selectedBody.data.accountId).toBe(attackerProfile.accountId);
      expect(selectedBody.data.accountId).not.toBe(original.accountId);
      expect(await victim.profile.get()).toEqual(original);
      expect((await request('/internal/v1/accounts/resolve', { method: 'POST', headers,
        body: JSON.stringify({ address: owner.address, chainId: 1 }),
      })).status).toBe(404);
    } finally {
      for (const account of [victim, client]) await account.auth.logout().catch(() => undefined);
    }
  }, 240_000);
  it('revokes the replayed refresh-token family without affecting another account', async () => {
    const apiBaseUrl = required('RARE_ACCOUNT_TEST_API_URL').replace(/\/$/u, '');
    const origin = new URL(apiBaseUrl);
    if (origin.protocol !== 'https:' || origin.hostname === 'api.superrare.com') throw new Error('Use a non-production HTTPS API');
    const owner = testWallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const attacker = testWallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(attacker.address.toLowerCase()).not.toBe(owner.address.toLowerCase());
    const victim = createRareAccountClient({ apiBaseUrl });
    const client = createRareAccountClient({ apiBaseUrl });
    const request = (path: string, init: RequestInit = {}) => retryRateLimit(async () => {
      const response = await fetch(`${apiBaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) throw { status: 429 };
      return response;
    });
    const form = (fields: Record<string, string>) => request('/auth/v2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
    });
    try {
      for (const [account, wallet] of [[victim, owner], [client, attacker]] as const) {
        await loginWithWallet(account, { address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
      }
      const original = await victim.profile.get();
      const session = await client.auth.getSession();
      if (!session) throw new Error('Missing attacker session');
      await client.auth.refresh();
      const replay = await form({ grant_type: 'refresh_token', client_id: 'rare-sdk', refresh_token: session.refreshToken });
      expect(replay.status).toBe(400);
      await expect(client.profile.get()).rejects.toThrow();
      expect((await victim.profile.get()).accountId).toBe(original.accountId);
    } finally {
      for (const account of [victim, client]) await account.auth.logout().catch(() => undefined);
    }
  }, 240_000);
  it('logs in with an existing account, updates its profile, refreshes and revokes', async () => {
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
    const login = (client: typeof first) => loginWithWallet(client, {
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

      const settings = {
        email: 'rare-sdk-profile@example.test',
        profile: {
          website: 'https://example.test/artist',
          twitterlink: 'https://x.com/rareartist',
          discordlink: 'https://discord.gg/rareartist',
          instagramlink: 'https://instagram.com/rareartist',
          youtubelink: 'https://youtube.com/rareartist',
          masthead_universal_token_id: '',
        },
      };
      expect(await first.profile.update(settings)).toMatchObject(settings);
      const publicApi = createRareApi({ baseUrl: apiBaseUrl });
      const publicProfile = await publicApi.resolveUser({ username: initial.username });
      expect(publicProfile.address.toLowerCase()).toBe(initial.address.toLowerCase());
      expect(publicProfile).toMatchObject({ website: settings.profile.website });
      expect(publicProfile).not.toHaveProperty('email');
      expect(await publicApi.getUser(initial.address)).not.toHaveProperty('email');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
      const uploaded = await first.profile.uploadAvatar(png, 'sdk-profile.png');
      expect(uploaded.profile.avatar).toMatch(/^https:\/\//);
      expect(await first.profile.update({ profile: { avatar: '' } })).toMatchObject({ profile: { avatar: '' } });
      expect(() => first.profile.update({ profile: { bio: 'x'.repeat(181) } })).toThrow();

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
  }, 240_000);
});
