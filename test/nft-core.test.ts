import { describe, expect, it } from 'vitest';
import { planNftTransferErc1155, planNftTransferErc721 } from '../src/sdk/nft-core.js';

const contract = '0x0000000000000000000000000000000000000001';
const recipient = '0x0000000000000000000000000000000000000002';

describe('NFT transfer planning', () => {
  it('normalizes ERC-721 token IDs and defaults calldata', () => {
    expect(planNftTransferErc721({
      contract,
      tokenId: '42',
      to: recipient,
    })).toEqual({
      contract,
      tokenId: 42n,
      to: recipient,
      from: undefined,
      data: '0x',
    });
  });

  it('normalizes ERC-1155 quantities and preserves calldata', () => {
    expect(planNftTransferErc1155({
      contract,
      tokenId: 0,
      quantity: '3',
      to: recipient,
      data: '0x1234',
    })).toEqual({
      contract,
      tokenId: 0n,
      quantity: 3n,
      to: recipient,
      from: undefined,
      data: '0x1234',
    });
  });

  it('rejects invalid token IDs and quantities before requesting a wallet', () => {
    expect(() => planNftTransferErc721({
      contract,
      tokenId: -1,
      to: recipient,
    })).toThrow('tokenId must be greater than or equal to 0');
    expect(() => planNftTransferErc1155({
      contract,
      tokenId: 1,
      quantity: 0,
      to: recipient,
    })).toThrow('quantity must be greater than 0');
  });
});
