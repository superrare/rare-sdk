import type { PublicClient } from 'viem';
import type { RareClientConfig } from './types/client.js';
import type { NftTransferNamespace } from './types/nft.js';
import { planNftTransferErc1155, planNftTransferErc721 } from './nft-core.js';
import { requireWallet } from './wallet-shell.js';

export type * from './types/nft.js';

const erc721TransferAbi = [{
  type: 'function',
  name: 'safeTransferFrom',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  outputs: [],
}] as const;

const erc1155TransferAbi = [{
  type: 'function',
  name: 'safeTransferFrom',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  outputs: [],
}] as const;

export function createNftTransferNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
): NftTransferNamespace {
  return {
    async erc721(params): ReturnType<NftTransferNamespace['erc721']> {
      const plan = planNftTransferErc721(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const from = plan.from ?? accountAddress;
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: erc721TransferAbi,
        functionName: 'safeTransferFrom',
        args: [from, plan.to, plan.tokenId, plan.data],
        account,
        chain: undefined,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new Error(`erc721 transfer transaction ${txHash} was mined with status "${receipt.status}".`);
      }
      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: plan.tokenId,
        from,
        to: plan.to,
        data: plan.data,
      };
    },

    async erc1155(params): ReturnType<NftTransferNamespace['erc1155']> {
      const plan = planNftTransferErc1155(params);
      const { walletClient, account, accountAddress } = requireWallet(config);
      const from = plan.from ?? accountAddress;
      const txHash = await walletClient.writeContract({
        address: plan.contract,
        abi: erc1155TransferAbi,
        functionName: 'safeTransferFrom',
        args: [from, plan.to, plan.tokenId, plan.quantity, plan.data],
        account,
        chain: undefined,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new Error(`erc1155 transfer transaction ${txHash} was mined with status "${receipt.status}".`);
      }
      return {
        txHash,
        receipt,
        contract: plan.contract,
        tokenId: plan.tokenId,
        quantity: plan.quantity,
        from,
        to: plan.to,
        data: plan.data,
      };
    },
  };
}
