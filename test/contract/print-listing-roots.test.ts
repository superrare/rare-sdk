import { describe, expect, it } from 'vitest';
import { createPublicClient, http, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient, type ArtworkPrintListingRoots } from '../../src/sdk/index.js';
import { createMemoryAccountSessionStore } from '../../src/sdk/account-session-store.js';

const origin = 'https://prints.example';
const tokenId = `1-${zeroAddress}-123`;
const scope = { chainId: '11155111', cartAddress: zeroAddress, seller: zeroAddress };
const digest = '0x1111111111111111111111111111111111111111111111111111111111111111';
const rootDigest = '0x2222222222222222222222222222222222222222222222222222222222222222';

async function createClient(apiFetch: typeof fetch) {
  const sessionStore = createMemoryAccountSessionStore();
  await sessionStore.set({
    revision: 'print-session',
    authBaseUrl: `${origin}/auth/v2`,
    apiBaseUrl: origin,
    clientId: 'rare-sdk',
    accessToken: 'print-access',
    refreshToken: 'print-refresh',
    expiresAt: Date.now() + 300_000,
    scope: 'rare:account offline_access',
  });
  return createRareClient({
    apiBaseUrl: origin,
    apiFetch,
    sessionStore,
    publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }),
  });
}

describe('print listing roots', () => {
  it('uses the account session and returns digests suitable for wallet cancellation', async () => {
    const data: ArtworkPrintListingRoots = {
      roots: [{ ...scope, rootDigest, listingDigests: [digest] }],
      individualListings: [{ ...scope, listingDigest: digest }],
    };
    const rare = await createClient(async (input, init) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe('/v1/prints/listing-roots');
      expect(new URL(request.url).searchParams.get('universalTokenId')).toBe(tokenId);
      expect(request.method).toBe('GET');
      expect(request.headers.get('authorization')).toBe('Bearer print-access');
      return Response.json({ data });
    });

    await expect(rare.prints.listings.rootsForArtwork(tokenId)).resolves.toEqual(data);
  });

  it('rejects a malformed root digest before returning it to the caller', async () => {
    const rare = await createClient(async () => Response.json({
      data: {
        roots: [{ ...scope, rootDigest: '0x1234', listingDigests: [digest] }],
        individualListings: [],
      },
    }));

    await expect(rare.prints.listings.rootsForArtwork(tokenId)).rejects.toThrow('invalid Cart digest');
  });
});
