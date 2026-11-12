import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, createWalletClient, custom, http, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import { buildCartListingRootArtifact, hashCartListing } from '../../src/sdk/cart-core.js';
import { getContractAddresses } from '../../src/contracts/addresses.js';
import type { PrintListingPreparation } from '../../src/sdk/types/prints.js';
import type { CartListing, CartListingPreparation, CartListingRootArtifact } from '../../src/sdk/types/cart.js';

const seller = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
const cart = getContractAddresses('sepolia').cart;
if (cart === undefined) throw new Error('Missing Cart deployment');
const listing: CartListing = { listingSalt: `0x${'11'.repeat(32)}`, seller: seller.address, sku: `0x${'22'.repeat(32)}`,
  fulfillmentKind: 1, tokenContract: zeroAddress, tokenId: 0n, settlementCurrency: zeroAddress,
  minimumUnitPrice: 100n, availableQuantity: 2n, paymentRecipient: seller.address, splits: [] };
const preparation: CartListingPreparation = {
  intent: { seller: seller.address, deadline: 2000000000n, listings: [{ sku: listing.sku, unitPrice: 100n, quantity: 2n, settlementCurrency: zeroAddress }] },
  artifact: buildCartListingRootArtifact({ listings: [listing], chainId: sepolia.id, cart, nonce: 0n, deadline: 2000000000n }),
  requiredApprovals: [],
};

describe('durable Cart publication over HTTP', () => {
  it('signs one root for multiple print preparations and retries that root without signing', async () => {
    const submissions: unknown[] = [];
    const reads: string[] = [];
    const checkpoints = new Map<string, string>();
    const recovery = {
      read: async (key: string) => checkpoints.get(key),
      save: async (key: string, value: string) => { checkpoints.set(key, value); },
    };
    const walletClient = createWalletClient({ chain: sepolia, account: seller, transport: http('http://localhost') });
    const prompts = vi.spyOn(walletClient, 'signTypedData');
    const client = createRareClient({
      publicClient: createPublicClient({ chain: sepolia, transport: custom({
        request: async () => `0x${'0'.repeat(64)}`,
      }) }),
      walletClient,
      transport: async (path: string, init?: RequestInit) => {
        if (init?.method === 'GET') {
          reads.push(path);
          const saved = preparations.find(({ id }) => path === `/v1/prints/listings/preparations/${id}`);
          return saved === undefined ? new Response(null, { status: 404 }) : Response.json({ data: saved });
        }
        expect(path).toBe('/v1/cart/listing-roots');
        const publication = JSON.parse(await new Response(init?.body).text());
        submissions.push(publication);
        return Response.json({ data: { ...publication.artifact, listingCount: publication.artifact.entries.length } });
      },
    });
    const preparations = ['1', '2'].map((suffix): PrintListingPreparation => {
      const terms = { ...listing, listingSalt: `0x${suffix.repeat(64)}` as const };
      const id = `00000000-0000-4000-8000-00000000000${suffix}`;
      return {
        id, user_id: '1', chain_id: String(sepolia.id), cart_address: cart,
        listing_digest: hashCartListing(terms, sepolia.id, cart),
        option_id: id, fulfillment_kind: 'PRODIGI_PRINT', listing_id: null, created_at: '',
        snapshot: { dropId: id, configured: { listing: { ...terms, tokenId: '0', minimumUnitPrice: '100', availableQuantity: '2' } },
          intent: { deadline: '2000000000' } },
      };
    });
    const result = await client.cart.listing.publish({ printPreparations: preparations, recovery, onSigned: () => {
      expect(submissions).toHaveLength(0);
    } });
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(result.signedArtifact.entries).toHaveLength(2);
    expect(result.signedArtifact.entries.every(({ proof }) => proof.length === 1)).toBe(true);
    await client.cart.listing.publish({ printPreparations: preparations, recovery });
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toEqual(submissions[1]);
    expect(submissions[0]).toMatchObject({ preparationIds: preparations.map(({ id }) => id) });

    const [saved] = preparations;
    if (saved === undefined) throw new Error('Missing saved print preparation');
    expect(await client.prints.listings.getPreparation(saved.id)).toEqual(saved);
    const single = await client.cart.listing.publish({ printPreparationId: saved.id });
    expect(single.signedArtifact.entries).toHaveLength(1);
    expect(submissions.at(-1)).toMatchObject({ preparationIds: [saved.id] });
    expect(reads).toEqual(Array.from({ length: 2 }, () => `/v1/prints/listings/preparations/${saved.id}`));
    await expect(client.cart.listing.publish({ printPreparationId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow();
    expect(prompts).toHaveBeenCalledTimes(2);
  });

  it('awaits durable signing, aborts on persistence failure, and resumes the exact authorization without signing', async () => {
    const publications: unknown[] = [];
    const saved: (CartListingRootArtifact & { signature: Hex })[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      publications.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: { id: 'published-root' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP fixture address');
    const origin = `http://127.0.0.1:${address.port}`;
    const walletClient = createWalletClient({ chain: sepolia, account: seller, transport: http(origin) });
    const config = { apiBaseUrl: origin, publicClient: createPublicClient({ chain: sepolia, transport: http(origin) }),
      transport: (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init) };
    try {
      const rare = createRareClient({ ...config, walletClient });
      await expect(rare.cart.listing.publish({ preparation, onSigned: async artifact => {
        await Promise.resolve();
        saved.push(artifact);
        throw new Error('journal unavailable');
      } })).rejects.toThrow('journal unavailable');
      expect(publications).toHaveLength(0);
      const signedArtifact = saved[0];
      if (signedArtifact === undefined) throw new Error('Signature not retained');
      const resumed = createRareClient({ ...config, walletClient: { ...walletClient,
        signTypedData: async () => { throw new Error('Recovery must not sign again'); } } });
      await expect(resumed.cart.listing.publish({ preparation, signedArtifact: { ...signedArtifact,
        root: { ...signedArtifact.root, nonce: '1' } } })).rejects.toThrow('does not match');
      await expect(resumed.cart.listing.publish({ preparation, signedArtifact: { ...signedArtifact, signature: '0x' } })).rejects.toThrow('does not match');
      await expect(resumed.cart.listing.publish({ preparation: { ...preparation, artifact: { ...preparation.artifact, chainId: 1 } }, signedArtifact })).rejects.toThrow();
      expect(publications).toHaveLength(0);
      const result = await resumed.cart.listing.publish({ preparation, signedArtifact, onSigned: async artifact => {
        expect(publications).toHaveLength(0);
        await Promise.resolve();
        // Callback mutation must not change the signature's submitted terms.
        artifact.root.nonce = '99';
      } });
      expect(result.signedArtifact).toEqual(signedArtifact);
      expect(publications).toHaveLength(1);
      const submitted = publications[0];
      expect(typeof submitted === 'object' && submitted !== null && 'artifact' in submitted ? submitted.artifact : submitted).toMatchObject({ ...signedArtifact, chainId: String(signedArtifact.chainId) });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
