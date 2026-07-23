import type { Address, Hex } from 'viem';
import type { IntegerInput, TransactionResult } from './common.js';

export type NftTransferErc721Params = {
  contract: Address;
  tokenId: IntegerInput;
  to: Address;
  from?: Address;
  data?: Hex;
}

export type NftTransferErc721Result = {
  contract: Address;
  tokenId: bigint;
  from: Address;
  to: Address;
  data: Hex;
} & TransactionResult

export type NftTransferErc1155Params = {
  contract: Address;
  tokenId: IntegerInput;
  quantity: IntegerInput;
  to: Address;
  from?: Address;
  data?: Hex;
}

export type NftTransferErc1155Result = {
  contract: Address;
  tokenId: bigint;
  quantity: bigint;
  from: Address;
  to: Address;
  data: Hex;
} & TransactionResult

export type NftTransferNamespace = {
  erc721: (params: NftTransferErc721Params) => Promise<NftTransferErc721Result>;
  erc1155: (params: NftTransferErc1155Params) => Promise<NftTransferErc1155Result>;
}
