import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';

const dropId = '11111111-1111-4111-8111-111111111111';
const optionId = '22222222-2222-4222-8222-222222222222';
const specificationIds = ['GLOBAL-FAP-8X12', 'GLOBAL-FAP-16X24'];

describe('ordinary print preparation through the SDK', () => {
  it('quotes without creating orders, prices size variants independently, and retains Product and mint associations', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const quote = { currency: 'USD', productionCostUsdCents: '500', shippingCostUsdCents: '350',
      quotedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-11-01T01:00:00Z',
      assumptions: { specificationId: specificationIds[0], copies: 1, destinationCountryCode: 'US', shippingMethod: 'Standard' }, warnings: ['estimate_only'] };
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const encoded = Buffer.concat(chunks).toString();
      const body: unknown = encoded ? JSON.parse(encoded) : undefined;
      calls.push({ path: request.url ?? '', method: request.method ?? '', body });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/prints/estimates') response.end(JSON.stringify({ data: quote }));
      else if (request.url?.endsWith('/options/standard')) response.end(JSON.stringify({ data: { id: optionId } }));
      else if (request.url?.startsWith('/v1/prints/drops/mine?')) response.end(JSON.stringify({ data: [], hasNextPage: false }));
      else response.end(JSON.stringify({ data: { id: dropId } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const origin = `http://127.0.0.1:${address.port}`;
    const rare = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }),
      transport: (path, init) => fetch(`${origin}${path}`, init) });
    try {
      const quoteInput = { specificationId: 'GLOBAL-FAP-8X12', destinationCountryCode: 'US' };
      expect(await rare.prints.quote(quoteInput)).toEqual(quote);
      expect(calls).toEqual([{ path: '/v1/prints/estimates', method: 'POST', body: quoteInput }]);
      expect(rare.prints).not.toHaveProperty('releaseManifests');
      expect(rare.prints).not.toHaveProperty('estimates');
      for (const [index, specificationId] of specificationIds.entries()) {
        const variantDropId = index === 0 ? dropId : '33333333-3333-4333-8333-333333333333';
        await rare.prints.drops.create({ idempotencyKey: variantDropId, chainId: '11155111', productId: '17', name: `Artwork ${specificationId}`, print: { productionUploadKey: 'a'.repeat(64), specificationId } });
        expect(calls.at(-1)?.body).toMatchObject({ productId: '17', print: { specificationId } });
        const input = { displayPriceUsdCents: index === 0 ? '1000' : '2000' };
        const configured = await rare.prints.options.configure({ dropId: variantDropId, input });
        expect(configured.id).toBe(optionId);
        expect(calls.at(-1)).toEqual({ path: `/v1/prints/drops/${variantDropId}/options/standard`, method: 'PUT', body: input });
      }
      // Explicit scalar input keeps production files on private drafts, not Product metadata.
      await rare.prints.drops.create({ idempotencyKey: dropId, chainId: '11155111', productId: '17', name: 'Artwork one', print: { productionUploadKey: 'a'.repeat(64) } });
      expect(calls.at(-1)?.body).toMatchObject({ productId: '17', print: { productionUploadKey: 'a'.repeat(64) } });
      await rare.prints.drops.listMine({ productId: '17' });
      expect(calls.at(-1)?.path).toContain('productId=17');
      const mintSource = { chainId: '11155111', contract: '0x1111111111111111111111111111111111111111', productIds: ['17', '18'] };
      await rare.prints.listings.prepare({ optionId, seller: zeroAddress, listingSalt: `0x${'11'.repeat(32)}`, deadline: '1999999999', availableQuantity: '2', mintSource });
      expect(calls.at(-1)?.body).toMatchObject({ mintSource });
      const previousCount = calls.length;
      await expect(rare.prints.quote({ ...quoteInput, copies: 0 })).rejects.toThrow();
      expect(calls).toHaveLength(previousCount);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
