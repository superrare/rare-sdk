import { getAddress, isHex, type Address, type Hex } from 'viem';
import { chainIds, isSupportedChain, type SupportedChain } from '../contracts/addresses.js';
import type { IntegerInput } from './types/common.js';
import type { NftTransferErc1155Params, NftTransferErc721Params } from './types/nft.js';
import { toInteger, toNonNegativeInteger, toPositiveInteger } from './amounts-core.js';

export type NftIdentityParams = {
  chain?: SupportedChain;
  chainId?: IntegerInput;
  contract: Address;
  tokenId: IntegerInput;
}

export function buildNftUniversalTokenId(params: NftIdentityParams): string {
  const chainId = resolveNftChainId(params);
  const tokenId = toInteger(params.tokenId, 'tokenId');
  if (tokenId < 0n) {
    throw new Error('tokenId must be greater than or equal to 0.');
  }

  return `${chainId.toString()}-${getAddress(params.contract)}-${tokenId.toString()}`;
}

export type NftTransferErc721Plan = {
  contract: Address;
  tokenId: bigint;
  to: Address;
  from?: Address;
  data: Hex;
}

export type NftTransferErc1155Plan = {
  contract: Address;
  tokenId: bigint;
  quantity: bigint;
  to: Address;
  from?: Address;
  data: Hex;
}

export function planNftTransferErc721(params: NftTransferErc721Params): NftTransferErc721Plan {
  return {
    contract: params.contract,
    tokenId: toNonNegativeInteger(params.tokenId, 'tokenId'),
    to: params.to,
    from: params.from,
    data: parseTransferData(params.data),
  };
}

export function planNftTransferErc1155(params: NftTransferErc1155Params): NftTransferErc1155Plan {
  return {
    contract: params.contract,
    tokenId: toNonNegativeInteger(params.tokenId, 'tokenId'),
    quantity: toPositiveInteger(params.quantity, 'quantity'),
    to: params.to,
    from: params.from,
    data: parseTransferData(params.data),
  };
}

function resolveNftChainId(params: NftIdentityParams): bigint {
  if (params.chainId !== undefined) {
    const chainId = toInteger(params.chainId, 'chainId');
    if (chainId <= 0n) {
      throw new Error('chainId must be greater than 0.');
    }
    return chainId;
  }

  if (params.chain !== undefined) {
    if (!isSupportedChain(params.chain)) {
      throw new Error(`Unsupported chain: ${params.chain}`);
    }
    return BigInt(chainIds[params.chain]);
  }

  throw new Error('Pass chainId or chain.');
}

function parseTransferData(data: Hex | undefined): Hex {
  if (data === undefined) return '0x';
  if (!isHex(data)) {
    throw new Error('data must be a hex value.');
  }
  return data;
}
