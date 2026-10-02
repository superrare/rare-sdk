import { isPrivateKeyString } from '../../src/sdk/validation.js';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareApi } from '../../src/sdk/api.js';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const wallet = (name: string) => { const key = required(name); if (!isPrivateKeyString(key)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(key); };
const origin = () => {
  const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
  return url.origin;
};
const noEmail = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(noEmail);
  else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) { expect(key.toLowerCase()).not.toContain('email'); noEmail(child); }
};

describe('creator posts against deployed services', () => {
  it('creates and reads publicly, comments across accounts, and favorites privately', async () => {
    const apiBaseUrl = origin();
    const ownerWallet = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherWallet = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(ownerWallet.address.toLowerCase()).not.toBe(otherWallet.address.toLowerCase());
    const owner = createRareAccountClient({ apiBaseUrl });
    const other = createRareAccountClient({ apiBaseUrl });
    const api = createRareApi({ baseUrl: apiBaseUrl });
    try {
    for (const [account, signer] of [[owner, ownerWallet], [other, otherWallet]] as const) await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
    const profile = await owner.profile.get();
    const before = await other.postFavorites.list();
    const post = await owner.posts.create({ title: `SDK integration ${Date.now()}`, body: '**Markdown** body', imageUrls: [] });
    try {
      expect(post.creatorUserId).toBe(profile.accountId);
      expect(await api.getPost(post.id)).toEqual(post);
      for (const selector of [{ address: ownerWallet.address }, { username: profile.username }, { userId: Number(profile.accountId) }]) {
        const page = await api.getPosts(selector, { perPage: 100 });
        expect(page.data.some(row => row.id === post.id)).toBe(true); noEmail(page);
      }
      const comment = await other.posts.comment(post.id, 'A public comment');
      const comments = await api.getPostComments(post.id);
      expect(comments.data.some(row => row.id === comment.id)).toBe(true); noEmail(comments);
      await Promise.all([other.postFavorites.add(post.id), other.postFavorites.add(post.id)]);
      expect(await other.postFavorites.has(post.id)).toBe(true);
      expect(await owner.postFavorites.has(post.id)).toBe(false);
      expect((await api.getPost(post.id)).likeCount).toBe(1);
      expect((await other.postFavorites.list()).data.some(row => row.id === post.id)).toBe(true);
      await other.postFavorites.remove(post.id);
      await other.postFavorites.remove(post.id);
      expect(await other.postFavorites.list()).toEqual(before);
      await other.posts.deleteComment(post.id, comment.id);
      expect((await api.getPostComments(post.id)).data).toEqual([]);
    } finally { await owner.posts.delete(post.id); }
    await expect(api.getPost(post.id)).rejects.toMatchObject({ status: 404 });
    await expect(api.getPostComments(post.id)).rejects.toMatchObject({ status: 404 });
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 180_000);

  it('rejects forged actors, other-account deletes, and private favorite selectors', async () => {
    const apiBaseUrl = origin();
    const ownerWallet = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherWallet = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    const owner = createRareAccountClient({ apiBaseUrl });
    const other = createRareAccountClient({ apiBaseUrl });
    try {
    const ownerSession = await owner.auth.loginWithWallet({ address: ownerWallet.address, chainId: 1, signMessage: message => ownerWallet.signMessage({ message }) });
    const otherSession = await other.auth.loginWithWallet({ address: otherWallet.address, chainId: 1, signMessage: message => otherWallet.signMessage({ message }) });
    const post = await owner.posts.create({ title: 'Authorization integration', body: 'Body' });
    try {
      const comment = await owner.posts.comment(post.id, 'Owned comment');
      await expect(other.posts.delete(post.id)).rejects.toMatchObject({ status: 403 });
      await expect(other.posts.deleteComment(post.id, comment.id)).rejects.toMatchObject({ status: 403 });
      const request = (path: string, method: string, token?: string, body?: unknown) => fetch(`${apiBaseUrl}${path}`, { method, signal: AbortSignal.timeout(30_000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const token of [undefined, 'invalid-token']) {
        expect((await request('/v1/posts', 'POST', token, { title: 'Forged', body: 'Body' })).status).toBe(401);
        expect((await request('/v1/me/post-favorites', 'GET', token)).status).toBe(401);
        expect((await request(`/v1/posts/${post.id}/comments`, 'POST', token, { body: 'Forged' })).status).toBe(401);
        expect((await request(`/v1/me/post-favorites/${post.id}`, 'PUT', token)).status).toBe(401);
      }
      expect((await request('/v1/posts', 'POST', otherSession.accessToken, { title: 'Forged', body: 'Body', creatorUserId: post.creatorUserId })).status).toBe(400);
      expect((await request(`/v1/posts/${post.id}/comments`, 'POST', otherSession.accessToken, { body: 'Forged', authorUserId: post.creatorUserId })).status).toBe(400);
      for (const query of ['userId=1', 'username=other', `address=${otherWallet.address}`]) expect((await request(`/v1/me/post-favorites?${query}`, 'GET', ownerSession.accessToken)).status).toBe(400);
      expect((await request(`/v1/posts/${post.id}/favorites`, 'GET')).status).toBe(404);
      await owner.posts.deleteComment(post.id, comment.id);
    } finally { await owner.posts.delete(post.id); }
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 180_000);
});
