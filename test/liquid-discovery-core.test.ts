import { describe, expect, it } from 'vitest';
import {
  buildLiquidEditionId,
  buildLiquidEditionSearchQuery,
  type LiquidEditionSearchParams,
} from '../src/sdk/liquid-discovery-core.js';

const contract = '0x1234567890123456789012345678901234567890';

describe('liquid discovery functional core', () => {
  it('maps full-text search and preserves all API filters without changing input', () => {
    const params: LiquidEditionSearchParams = Object.freeze({
      query: 'art & light', chainId: 1, contractAddress: contract,
      creatorAddress: contract, holderAddress: contract, isApprovedCreator: false,
      hasCurrentPrice: true, currentPriceCurrencyAddress: contract,
      priceMin: 0, priceMax: 100, mediaType: 'IMAGE', tags: ['light & color', 'art'],
      sortBy: 'priceAsc', page: 2, perPage: 100,
    });
    expect(buildLiquidEditionSearchQuery(params)).toEqual({
      q: 'art & light', chainId: 1, contractAddress: contract,
      creatorAddress: contract, holderAddress: contract, isApprovedCreator: 'false',
      hasCurrentPrice: 'true', currentPriceCurrencyAddress: contract,
      priceMin: 0, priceMax: 100, mediaType: 'IMAGE', tags: ['light & color', 'art'],
      sortBy: 'priceAsc', page: 2, perPage: 100,
    });
    expect(params.query).toBe('art & light');
    expect(params).not.toHaveProperty('q');
  });

  it('leaves defaults and validation to the API and retains false flags', () => {
    expect(buildLiquidEditionSearchQuery()).toEqual({ q: undefined, isApprovedCreator: undefined, hasCurrentPrice: undefined });
    expect(buildLiquidEditionSearchQuery({ hasCurrentPrice: false, priceMax: 0 }))
      .toEqual({ q: undefined, isApprovedCreator: undefined, hasCurrentPrice: 'false', priceMax: 0 });
  });

  it.each([
    ['mainnet', 1], ['sepolia', 11155111], ['base', 8453],
  ] as const)('builds edition identity for %s', (chain, chainId) => {
    expect(buildLiquidEditionId(chain, { contract })).toBe(`${chainId}-${contract}`);
  });

  it.each([{ chainId: 8453 }, { chain: 'base' }, { chainId: undefined }])(
    'rejects a per-call chain override: %j', (override) => {
      expect(() => buildLiquidEditionId('sepolia', { contract, ...override }))
        .toThrow('uses the RareClient chain (sepolia)');
    },
  );
});
