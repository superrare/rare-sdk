import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import type { CreatePrintDrop } from '../../src/sdk/types/prints.js';

describe('print batch authoring over HTTP', () => {
  it('continues after a failed item, skips completed results, and reuses request keys on retry', async () => {
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString();
      requests.push(body);
      response.setHeader('Content-Type', 'application/json');
      if (requests.length === 2 || requests.length === 3) {
        response.writeHead(503);
        response.end(JSON.stringify({ error: 'upstream_unavailable', message: 'Try again later' }));
      } else {
        response.end(JSON.stringify({ data: { id: requests.length === 1 ? 'first' : 'second' } }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const apiBaseUrl = `http://127.0.0.1:${address.port}`;
    const rare = createRareClient({ apiBaseUrl, publicClient: createPublicClient({ chain: sepolia, transport: http() }),
      transport: (path, init) => fetch(`${apiBaseUrl}${path}`, init) });
    const print = { name: 'Print edition', description: 'Archival print', tags: [],
      productionUploadKey: 'a'.repeat(64), images: ['https://example.com/preview.png'], specificationId: 'GLOBAL-FAP-8X12' };
    const first: CreatePrintDrop = { name: 'First', chainId: '11155111', idempotencyKey: randomUUID(), print };
    const second: CreatePrintDrop = { name: 'Second', chainId: '11155111', idempotencyKey: randomUUID(), print };
    const items = [{ key: 'first', input: first }, { key: 'second', input: second }];
    try {
      await expect(rare.prints.drops.create([{ key: 'duplicate', input: first }, { key: 'duplicate', input: second }])).rejects.toThrow('unique');
      expect(requests).toHaveLength(0);
      const result = await rare.prints.drops.create(items);
      expect(result).toMatchObject([{ key: 'first', status: 'fulfilled', value: { id: 'first' } }, { key: 'second', status: 'rejected' }]);
      await expect(rare.prints.drops.create([{ key: 'first', input: { ...first, name: 'Changed' } }, { key: 'second', input: second }], { previousResults: result })).rejects.toThrow('changed terms');
      expect(requests).toHaveLength(3);
      const retried = await rare.prints.drops.create(items, { previousResults: result });
      expect(retried).toMatchObject([{ key: 'first', status: 'fulfilled', value: { id: 'first' } }, { key: 'second', status: 'fulfilled', value: { id: 'second' } }]);
      expect(requests).toHaveLength(4);
      expect(requests[1]).toBe(requests[2]);
      expect(requests[2]).toBe(requests[3]);
      expect(JSON.parse(requests[0] ?? '')).toEqual(first);
      expect(JSON.parse(requests[3] ?? '')).toEqual(second);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
