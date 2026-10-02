import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';

const deployedAccount = () => {
  const api = process.env.RARE_ACCOUNT_TEST_API_URL;
  const secret = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!api || !secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error('Configure deployed account test API and wallet');
  const origin = new URL(api);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.hostname === 'api.superrare.com') throw new Error('Use a dev feature API origin');
  const wallet = privateKeyToAccount(secret as `0x${string}`);
  return { api: origin.origin, wallet, client: createRareAccountClient({ apiBaseUrl: origin.origin }) };
};

const objectKey = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const removeObject = (key: string): void => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid test object key');
  try {
    execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'rm', `gs://rare-api-upload-dev/${key}`], { stdio: 'pipe' });
  } catch (error) {
    // Rejected requests and failures before storage have no object to delete.
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error && error.stderr instanceof Uint8Array
      ? Buffer.from(error.stderr).toString('utf8') : '';
    if (!/No URLs matched|NotFoundException|HTTPError 404|does not exist/.test(stderr)) throw error;
  }
};

const withLiveAccount = async (operation: (account: ReturnType<typeof deployedAccount>, track: (bytes: Uint8Array) => void) => Promise<void>): Promise<void> => {
  const account = deployedAccount();
  // Fail before writes if cleanup access is unavailable.
  execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'buckets', 'describe', 'gs://rare-api-upload-dev', '--format=value(name)'], { stdio: 'pipe' });
  const keys = new Set<string>();
  const track = (bytes: Uint8Array): void => {
    // Register the intended key before transmission, including ambiguous failures.
    // eslint-disable-next-line functional/immutable-data
    keys.add(objectKey(bytes));
  };
  try {
    await account.client.auth.loginWithWallet({ address: account.wallet.address, chainId: 1, signMessage: message => account.wallet.signMessage({ message }) });
    await operation(account, track);
  } finally {
    const cleanup = await Promise.allSettled([
      account.client.auth.logout(),
      ...[...keys].map(key => Promise.resolve().then(() => removeObject(key))),
    ]);
    const failed = cleanup.filter(result => result.status === 'rejected');
    if (failed.length > 0) throw new AggregateError(failed.map(result => result.reason), 'Live upload cleanup failed');
  }
};

const uploadRequest = (api: string, bytes: Uint8Array, authorization?: string, fields?: Record<string, string>) => {
  const body = new FormData();
  body.set('file', new Blob([new Uint8Array(bytes)]), 'file.bin');
  for (const [key, value] of Object.entries(fields ?? {})) body.set(key, value);
  return fetch(`${api}/v1/uploads`, { method: 'POST', headers: authorization ? { authorization } : {}, body, signal: AbortSignal.timeout(60_000) });
};

describe('uploads through deployed API and real GCS', () => {
  it('deduplicates concurrent uploads, preserves stored metadata, and does not edit profiles', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const bytes = randomBytes(1024);
      track(bytes);
      const before = await client.profile.get();
      const results = await Promise.all([client.uploads.upload(bytes, 'first.bin'), client.uploads.upload(bytes, 'second.bin')]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ key: objectKey(bytes), size: bytes.length, contentType: 'application/octet-stream', previewUrl: null });
      expect(await client.uploads.upload(bytes, 'pretend.png', { contentType: 'image/png' })).toEqual(results[0]);
      expect(await client.profile.get()).toEqual(before);
      const downloaded = await fetch(results[0]!.url, { signal: AbortSignal.timeout(30_000) });
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get('content-disposition')).toContain('attachment');
      expect(downloaded.headers.get('cache-control')).toContain('immutable');
      expect(downloaded.headers.get('content-type')).toContain('application/octet-stream');
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    });
  }, 180_000);

  it('uploads an avatar through shared storage, attaches it, and clears it without changing other fields', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const before = await client.profile.get();
      // Add a valid GIF comment extension before the trailer to give this run unique bytes.
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const comment = Buffer.from(randomBytes(16).toString('hex'));
      const bytes = Buffer.concat([gif.subarray(0, -1), Buffer.from([0x21, 0xfe, comment.length]), comment, Buffer.from([0, 0x3b])]);
      track(bytes);
      try {
        const updated = await client.profile.uploadAvatar(bytes, 'avatar.gif');
        expect(updated.profile.avatar).toBe(`https://storage.googleapis.com/rare-api-upload-dev/${objectKey(bytes)}`);
        expect(updated).toEqual({ ...before, profile: { ...before.profile, avatar: updated.profile.avatar } });
        expect(await client.profile.get()).toEqual(updated);
        const downloaded = await fetch(updated.profile.avatar!, { signal: AbortSignal.timeout(30_000) });
        expect(downloaded.status).toBe(200);
        expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
        const cleared = await client.profile.update({ profile: { avatar: '' } });
        expect(cleared).toEqual({ ...before, profile: { ...before.profile, avatar: '' } });
      } finally {
        await client.profile.update({ profile: { avatar: before.profile.avatar ?? '' } });
      }
    });
  }, 180_000);

  it('rejects unauthenticated, empty, oversized and unexpected-field uploads at the live HTTP boundary', async () => {
    await withLiveAccount(async ({ api, client }, track) => {
      const session = await client.auth.getSession();
      if (!session) throw new Error('Missing live session');
      const authorization = `Bearer ${session.accessToken}`;
      const bytes = randomBytes(1024);
      track(bytes);
      for (const credential of [undefined, 'Bearer forged']) expect((await uploadRequest(api, bytes, credential)).status).toBe(401);
      expect((await uploadRequest(api, bytes, authorization, { accountId: 'another-account' })).status).toBe(400);
      expect((await uploadRequest(api, new Uint8Array(), authorization)).status).toBe(400);
      const tooLarge = randomBytes(20 * 1024 * 1024 + 1);
      track(tooLarge);
      // Bypass SDK prevalidation so the deployed server must reject the request.
      expect((await uploadRequest(api, tooLarge, authorization)).status).toBe(413);
    });
  }, 180_000);
});
