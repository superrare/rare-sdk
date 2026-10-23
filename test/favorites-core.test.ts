import { describe, expect, it } from 'vitest';
import { favoritePageQuery, normalizeFavoriteId, parseFavoriteStatus, parseFavoritesPage } from '../src/sdk/favorites-core.js';
const contract = '0x1234567890abcdef1234567890abcdef12345678';
const id = `1-${contract}-7`;
describe('artwork favorites core', () => {
  it('normalizes identities and rejects invalid input before I/O', () => {
    expect(normalizeFavoriteId(`01-${contract.toUpperCase().replace('0X', '0x')}-007`)).toBe(id);
    expect(normalizeFavoriteId({ chainId: 1, contract, tokenId: 7 })).toBe(id);
    for (const value of ['invalid', `${id}-extra`, `0-${contract}-7`, `1-${contract}--1`, `1-${contract}-${2n ** 256n}`]) expect(() => normalizeFavoriteId(value)).toThrow();
    for (const options of [{ page: 0 }, { perPage: 101 }, { page: 1.5 }, { page: 2147483647, perPage: 100 }]) expect(() => favoritePageQuery(options)).toThrow();
  });
  it('validates private response shapes and projects only documented fields', () => {
    expect(parseFavoriteStatus({ data: { favorited: false } })).toBe(false);
    for (const value of [{ data: { favorited: 'true' } }, {}, { data: null }]) expect(() => parseFavoriteStatus(value)).toThrow();
    const result = parseFavoritesPage({ data: [{ universalTokenId: id, chainId: '1', contractAddress: contract, tokenId: '7', createdAt: '2026-10-02T00:00:00.000Z', metadata: { name: null }, userId: 123, email: 'private' }], pagination: { page: 1, perPage: 20, totalCount: 1, totalPages: 1 } });
    expect(result.data[0]?.metadata.name).toBeNull();
    expect(JSON.stringify(result)).not.toContain('email');
    expect(JSON.stringify(result)).not.toContain('userId');
  });
});
