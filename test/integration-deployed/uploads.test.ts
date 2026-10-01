import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';

it('uploads arbitrary bytes, deduplicates concurrent uploads, and rejects unauthenticated uploads', async () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL;
  const secret = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!apiBaseUrl || !secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error('Configure deployed account test API and wallet');
  if (new URL(apiBaseUrl).protocol !== 'https:' || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Use a dev feature API');
  const wallet = privateKeyToAccount(secret as `0x${string}`);
  const client = createRareAccountClient({ apiBaseUrl });
  const bytes = randomBytes(1024);
  const key = createHash('sha256').update(bytes).digest('hex');
  const urls = new Set<string>();
  try {
    await client.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
    const before = await client.profile.get();
    const results = await Promise.all([0, 1].map(async () => {
      const result = await client.uploads.upload(bytes, 'arbitrary.bin');
      // Track successful live writes so partial failures still clean up their objects.
      // eslint-disable-next-line functional/immutable-data
      urls.add(result.url);
      return result;
    }));
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ key, size: bytes.length, contentType: 'application/octet-stream', previewUrl: null });
    expect(await client.profile.get()).toEqual(before);
    const downloaded = await fetch(results[0]!.url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    for (const authorization of [undefined, 'Bearer forged']) {
      const body = new FormData();
      body.set('file', new Blob([bytes]), 'file.bin');
      const response = await fetch(`${apiBaseUrl}/v1/uploads`, {
        method: 'POST', headers: authorization ? { authorization } : {}, body,
      });
      expect(response.status).toBe(401);
    }
  } finally {
    try {
      await client.auth.logout();
    } finally {
    for (const source of urls) {
      const url = new URL(source);
      if (url.hostname !== 'storage.googleapis.com' || url.pathname !== `/rare-api-upload-dev/${key}`)
        throw new Error('Refusing cleanup outside the isolated dev upload');
      execFileSync('gcloud', ['storage', 'rm', `gs://rare-api-upload-dev/${key}`], { stdio: 'pipe' });
    }
    }
  }
}, 120_000);
