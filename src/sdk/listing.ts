import {
  type Address,
  type PublicClient,
} from 'viem';
import { auctionAbi } from '../contracts/abis/auction.js';
import { ETH_ADDRESS, type SupportedChain } from '../contracts/addresses.js';
import type {
  ListingMarketplaceNamespace,
} from './types/listing.js';
import type { RareClientConfig } from './types/client.js';
import { approveNftContractIfNeeded, createApprovalSideEffectAlert } from './approvals-shell.js';
import {
  preparePaymentForSpender,
  toCurrencyAmount,
} from './payments-shell.js';
import { requireWallet } from './wallet-shell.js';
import { requireInput } from './validation-core.js';
import {
  planListingBuy,
  planListingCancel,
  planListingCreate,
  planListingStatus,
  shapeListingStatus,
} from './marketplace-core.js';
import { resolveCurrencyForSdk } from './currency.js';
import { waitForSuccessfulTransactionReceipt } from './transaction-receipt.js';
import { defineTransactionMethod } from './transaction-submission.js';

export type * from './types/listing.js';

export function createListingNamespace(
  publicClient: PublicClient,
  config: RareClientConfig,
  chain: SupportedChain,
  addresses: { auction: Address },
): ListingMarketplaceNamespace {
  return {
    create: defineTransactionMethod(async (params) => {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = await toCurrencyAmount(publicClient, chain, currency, params.price, 'price');
      const plan = planListingCreate({ ...params, currency, price }, accountAddress);
      const approvalTxHash = await approveNftContractIfNeeded({
        publicClient,
        walletClient,
        account,
        accountAddress,
        nftAddress: plan.nftAddress,
        operator: addresses.auction,
        autoApprove: params.autoApprove,
      });

      const withApprovalAlert = createApprovalSideEffectAlert({
        operation: 'listing create',
        approvals: [{
          type: 'nft',
          approvalTxHash,
          target: plan.nftAddress,
          operator: addresses.auction,
        }],
      });
      const txHash = await withApprovalAlert(() => walletClient.writeContract({
        address: addresses.auction,
        abi: auctionAbi,
        functionName: 'setSalePrice',
        args: [
          plan.nftAddress,
          plan.tokenId,
          plan.currency,
          plan.price,
          plan.target,
          plan.splitAddresses,
          plan.splitRatios,
        ],
        account,
        chain: undefined,
      }));

      return {
        submitted: { txHash, approvalTxHash },
        settle: async () => {
          const receipt = await withApprovalAlert(() => waitForSuccessfulTransactionReceipt(publicClient, {
            txHash,
            operation: 'listing create',
            marketplace: addresses.auction,
            contract: plan.nftAddress,
            tokenId: plan.tokenId,
          }));
          return { txHash, receipt, approvalTxHash };
        },
      };
    }),

    cancel: defineTransactionMethod(async (params) => {
      const { walletClient, account } = requireWallet(config);
      const plan = planListingCancel(params);

      const targetTxHash = await walletClient.writeContract({
        address: addresses.auction,
        abi: auctionAbi,
        functionName: 'removeSalePrice',
        args: [params.contract, plan.tokenId, plan.target],
        account,
        chain: undefined,
      });

      return {
        submitted: { txHash: targetTxHash },
        settle: async () => {
          const targetReceipt = await waitForSuccessfulTransactionReceipt(publicClient, {
            txHash: targetTxHash,
            operation: 'listing cancel',
            marketplace: addresses.auction,
            contract: params.contract,
            tokenId: plan.tokenId,
          });
          return { txHash: targetTxHash, receipt: targetReceipt };
        },
      };
    }),

    buy: defineTransactionMethod(async (params) => {
      const { walletClient, account, accountAddress } = requireWallet(config);
      const currency = params.currency === undefined ? ETH_ADDRESS : resolveCurrencyForSdk(params.currency, chain).address;
      const price = requireInput(params.price, 'price');
      const amount = await toCurrencyAmount(publicClient, chain, currency, price, 'price');
      const plan = planListingBuy({ ...params, price: amount, currency });

      const payment = await preparePaymentForSpender({
        publicClient, walletClient, account, accountAddress,
        marketplaceSettingsSource: addresses.auction,
        spenderAddress: addresses.auction,
        currency: plan.currency,
        amount: plan.amount,
        autoApprove: params.autoApprove,
      });

      const withApprovalAlert = createApprovalSideEffectAlert({
        operation: 'listing buy',
        approvals: [{
          type: 'erc20',
          approvalTxHash: payment.approvalTxHash,
          target: plan.currency,
          spender: addresses.auction,
        }],
      });
      const txHash = await withApprovalAlert(() => walletClient.writeContract({
        address: addresses.auction,
        abi: auctionAbi,
        functionName: 'buy',
        args: [params.contract, plan.tokenId, plan.currency, plan.amount],
        account,
        chain: undefined,
        value: payment.value,
      }));

      return {
        submitted: { txHash, approvalTxHash: payment.approvalTxHash },
        settle: async () => {
          const receipt = await withApprovalAlert(() => waitForSuccessfulTransactionReceipt(publicClient, {
            txHash,
            operation: 'listing buy',
            marketplace: addresses.auction,
            contract: params.contract,
            tokenId: plan.tokenId,
          }));
          return { txHash, receipt, approvalTxHash: payment.approvalTxHash };
        },
      };
    }),

    async status(params): ReturnType<ListingMarketplaceNamespace['status']> {
      const plan = planListingStatus(params);

      const result = await publicClient.readContract({
        address: addresses.auction,
        abi: auctionAbi,
        functionName: 'getSalePrice',
        args: [params.contract, plan.tokenId, plan.target],
      });

      const wallet = config.account ?? config.walletClient?.account?.address ?? null;
      return shapeListingStatus(result, { target: plan.target, wallet });
    },
  };
}
