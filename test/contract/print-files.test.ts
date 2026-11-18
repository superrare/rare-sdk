import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import { createMemoryAccountSessionStore } from '../../src/sdk/account-session-store.js';
import { RareApiError } from '../../src/data-access/errors.js';

const input = { productionUploadKey: 'a'.repeat(64), specificationId: 'GLOBAL-FAP-8X12' };
const mockupId = '11111111-1111-4111-8111-111111111111';
const validation = { valid: true, status: 'warning', issues: [{ code: 'resolution_low', field: 'file', message: 'Resolution is low.', severity: 'warning' }] };
const completed = { id: mockupId, status: 'completed', result: { url: 'https://example.com/preview.jpg', widthPx: 800, heightPx: 1200 } };

describe('owned print file and mockup methods over HTTP', () => {
  it('uses account authentication without a signing wallet and returns private preview job data', async () => {
    const requests: { path: string; method: string; authorization: string | undefined; body: unknown }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      const body: unknown = text.length > 0 ? JSON.parse(text) : undefined;
      requests.push({ path: request.url ?? '', method: request.method ?? '', authorization: request.headers.authorization, body });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/prints/files/validate') response.end(JSON.stringify({ data: validation }));
      else if (request.method === 'POST') {
        response.statusCode = 202;
        response.end(JSON.stringify({ data: { id: mockupId, status: 'pending' } }));
      } else if (request.url?.endsWith('/22222222-2222-4222-8222-222222222222')) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'Preview not found', code: 'not_found' }));
      } else response.end(JSON.stringify({ data: completed }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const origin = `http://127.0.0.1:${address.port}`;
    const sessionStore = createMemoryAccountSessionStore();
    await sessionStore.set({ revision: 'print-session', authBaseUrl: `${origin}/auth/v2`, apiBaseUrl: origin,
      clientId: 'rare-sdk', accessToken: 'print-access', refreshToken: 'print-refresh', expiresAt: Date.now() + 300_000,
      scope: 'rare:account offline_access' });
    const rare = createRareClient({ apiBaseUrl: origin, sessionStore,
      publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }) });
    try {
      expect(await rare.prints.files.validate(input)).toEqual(validation);
      expect(await rare.prints.mockups.create(input)).toEqual({ id: mockupId, status: 'pending' });
      expect(await rare.prints.mockups.get(mockupId)).toEqual(completed);
      expect(requests).toEqual([
        { path: '/v1/prints/files/validate', method: 'POST', authorization: 'Bearer print-access', body: input },
        { path: '/v1/prints/mockups', method: 'POST', authorization: 'Bearer print-access', body: input },
        { path: `/v1/prints/mockups/${mockupId}`, method: 'GET', authorization: 'Bearer print-access', body: undefined },
      ]);
      await expect(rare.prints.mockups.get('22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({
        status: 404, code: 'not_found', path: '/v1/prints/mockups/22222222-2222-4222-8222-222222222222',
      });
      await expect(rare.prints.mockups.get('22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(RareApiError);
      const count = requests.length;
      await expect(rare.prints.files.validate({ ...input, productionUploadKey: 'https://example.com/master.jpg' })).rejects.toThrow('private production upload key');
      await expect(rare.prints.mockups.create({ ...input, specificationId: ' ' })).rejects.toThrow('specification ID');
      const providerInput = { ...input, assetId: 'arbitrary-provider-asset' };
      await expect(rare.prints.mockups.create(providerInput)).rejects.toThrow('private production upload key');
      await expect(rare.prints.mockups.get('provider-job-id')).rejects.toThrow('Rare print mockup ID');
      const aborted = AbortSignal.abort();
      await expect(rare.prints.files.validate(input, { signal: aborted })).rejects.toThrow();
      await expect(rare.prints.mockups.create(input, { signal: aborted })).rejects.toThrow();
      await expect(rare.prints.mockups.get(mockupId, { signal: aborted })).rejects.toThrow();
      expect(requests).toHaveLength(count);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
