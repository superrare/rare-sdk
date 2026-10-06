import { describe, expect, expectTypeOf, it } from 'vitest';
import { zeroAddress, type Address, type Hash } from 'viem';
import { batchAuctionHouseAbi } from '../src/contracts/abis/batch-auctionhouse.js';
import { batchOfferAbi } from '../src/contracts/abis/batch-offer.js';
import { factoryAbi } from '../src/contracts/abis/factory.js';
import { tokenAbi } from '../src/contracts/abis/token.js';
import { getContractAddresses, resolveCurrency } from '../src/contracts/addresses.js';
import { ApprovalSideEffectError } from '../src/sdk/approvals-shell.js';
import { hashBatchToken } from '../src/sdk/batch-core.js';
import { createRareClient } from '../src/sdk/client.js';
import type {
  AuctionBidResult,
  RareClient,
  SubmittedTransaction,
  TransactionResult,
} from '../src/sdk/index.js';
import {
  account,
  createChainDouble,
  eventLog,
  type ChainDouble,
  type ChainDoubleOptions,
} from './support/chain-double.js';

const addresses = getContractAddresses('sepolia');
const usdc = resolveCurrency('usdc', 'sepolia');
const nft: Address = '0x00000000000000000000000000000000000000C1';
const counterparty: Address = '0x00000000000000000000000000000000000000D1';
const root = hashBatchToken(nft, 1n);
const marketplaceSettings: Address = '0x00000000000000000000000000000000000000E1';

type Scenario = {
  name: string;
  approval?: 'erc20' | 'nft';
  options?: ChainDoubleOptions;
  receiptFailure: ChainDoubleOptions;
  confirm: (rare: RareClient) => Promise<unknown>;
  submit: (rare: RareClient) => Promise<{ txHash: Hash; wait: () => Promise<unknown> }>;
};

const scenarios: Scenario[] = [
  {
    name: 'auction.settle (plain write)',
    receiptFailure: { receiptStatus: 'reverted' },
    confirm: (rare) => rare.auction.settle({ contract: nft, tokenId: 1n }),
    submit: (rare) => rare.auction.settle({ contract: nft, tokenId: 1n, waitForReceipt: false }),
  },
  {
    name: 'auction.bid (ERC20 approval)',
    approval: 'erc20',
    options: { reads: { marketplaceSettings, calculateMarketplaceFee: 30_000n } },
    receiptFailure: { receiptStatus: 'reverted' },
    confirm: (rare) => rare.auction.bid({ contract: nft, tokenId: 1n, price: 1_000_000n, currency: 'usdc' }),
    submit: (rare) => rare.auction.bid({
      contract: nft,
      tokenId: 1n,
      price: 1_000_000n,
      currency: 'usdc',
      waitForReceipt: false,
    }),
  },
  {
    name: 'listing.create (NFT approval)',
    approval: 'nft',
    receiptFailure: { receiptStatus: 'reverted' },
    confirm: (rare) => rare.listing.create({ contract: nft, tokenId: 1n, price: 1n }),
    submit: (rare) => rare.listing.create({ contract: nft, tokenId: 1n, price: 1n, waitForReceipt: false }),
  },
  {
    name: 'offer.cancel (plain write)',
    receiptFailure: { receiptError: new Error('receipt polling timed out') },
    confirm: (rare) => rare.offer.cancel({ contract: nft, tokenId: 1n }),
    submit: (rare) => rare.offer.cancel({ contract: nft, tokenId: 1n, waitForReceipt: false }),
  },
  {
    name: 'auction.batch.cancel (receipt-derived values)',
    options: {
      receiptLogs: [eventLog({
        address: addresses.batchAuctionHouse ?? zeroAddress,
        abi: batchAuctionHouseAbi,
        eventName: 'AuctionMerkleRootCancelled',
        args: { creator: account, merkleRoot: root },
      })],
    },
    receiptFailure: { receiptLogs: [] },
    confirm: (rare) => rare.auction.batch.cancel({ root }),
    submit: (rare) => rare.auction.batch.cancel({ root, waitForReceipt: false }),
  },
  {
    name: 'listing.batch.cancel (plain write)',
    receiptFailure: { receiptError: new Error('receipt polling timed out') },
    confirm: (rare) => rare.listing.batch.cancel({ root }),
    submit: (rare) => rare.listing.batch.cancel({ root, waitForReceipt: false }),
  },
  {
    name: 'offer.batch.revoke (receipt-derived values)',
    options: {
      receiptLogs: [eventLog({
        address: addresses.batchOfferCreator ?? zeroAddress,
        abi: batchOfferAbi,
        eventName: 'BatchOfferRevoked',
        args: { creator: account, rootHash: root, currency: usdc, amount: 5n },
      })],
    },
    receiptFailure: { receiptLogs: [] },
    confirm: (rare) => rare.offer.batch.revoke({ root }),
    submit: (rare) => rare.offer.batch.revoke({ root, waitForReceipt: false }),
  },
  {
    name: 'offer.batch.accept (NFT approval with receipt-derived values)',
    approval: 'nft',
    options: {
      reads: { ownerOf: account },
      receiptLogs: [eventLog({
        address: addresses.batchOfferCreator ?? zeroAddress,
        abi: batchOfferAbi,
        eventName: 'BatchOfferAccepted',
        args: {
          seller: account,
          buyer: counterparty,
          contractAddress: nft,
          tokenId: 1n,
          rootHash: root,
          currency: usdc,
          amount: 5n,
        },
      })],
    },
    receiptFailure: { reads: { ownerOf: account }, receiptLogs: [] },
    confirm: (rare) => rare.offer.batch.accept({ creator: counterparty, root, proof: [], contract: nft, tokenId: 1n }),
    submit: (rare) => rare.offer.batch.accept({
      creator: counterparty,
      root,
      proof: [],
      contract: nft,
      tokenId: 1n,
      waitForReceipt: false,
    }),
  },
  {
    name: 'bridge.send (ERC20 approval with receipt-derived values)',
    approval: 'erc20',
    options: { reads: { getFee: 10n } },
    receiptFailure: { reads: { getFee: 10n }, receiptError: new Error('receipt polling timed out') },
    confirm: (rare) => rare.bridge.send({ destinationChain: 'base-sepolia', amount: 5n }),
    submit: (rare) => rare.bridge.send({ destinationChain: 'base-sepolia', amount: 5n, waitForReceipt: false }),
  },
  {
    name: 'collection.mint (receipt-derived values)',
    options: {
      receiptLogs: [eventLog({
        address: nft,
        abi: tokenAbi,
        eventName: 'Transfer',
        args: { from: zeroAddress, to: account, tokenId: 7n },
      })],
    },
    receiptFailure: { receiptLogs: [] },
    confirm: (rare) => rare.collection.mint({ contract: nft, tokenUri: 'ipfs://token' }),
    submit: (rare) => rare.collection.mint({ contract: nft, tokenUri: 'ipfs://token', waitForReceipt: false }),
  },
  {
    name: 'collection.setDefaultRoyaltyReceiver (plain write)',
    receiptFailure: { receiptError: new Error('receipt polling timed out') },
    confirm: (rare) => rare.collection.setDefaultRoyaltyReceiver({ contract: nft, receiver: counterparty }),
    submit: (rare) => rare.collection.setDefaultRoyaltyReceiver({
      contract: nft,
      receiver: counterparty,
      waitForReceipt: false,
    }),
  },
  {
    name: 'collection.deploy.erc721 (receipt-derived values)',
    options: {
      receiptLogs: [eventLog({
        address: addresses.factory,
        abi: factoryAbi,
        eventName: 'SovereignBatchMintCreated',
        args: { contractAddress: nft, owner: account },
      })],
    },
    receiptFailure: { receiptLogs: [] },
    confirm: (rare) => rare.collection.deploy.erc721({ name: 'Name', symbol: 'SYM' }),
    submit: (rare) => rare.collection.deploy.erc721({ name: 'Name', symbol: 'SYM', waitForReceipt: false }),
  },
  {
    name: 'listing.erc1155.cancel (plain write)',
    receiptFailure: { receiptStatus: 'reverted' },
    confirm: (rare) => rare.listing.erc1155.cancel({ contract: nft, tokenIds: [1n] }),
    submit: (rare) => rare.listing.erc1155.cancel({ contract: nft, tokenIds: [1n], waitForReceipt: false }),
  },
  {
    name: 'liquidEdition.setRenderContract (plain write)',
    receiptFailure: { receiptStatus: 'reverted' },
    confirm: (rare) => rare.liquidEdition.setRenderContract({ contract: nft, renderContract: counterparty }),
    submit: (rare) => rare.liquidEdition.setRenderContract({
      contract: nft,
      renderContract: counterparty,
      waitForReceipt: false,
    }),
  },
  {
    name: 'listing.release.limits.setMint (receipt-derived read-back)',
    options: { reads: { owner: account, getContractMintLimit: 5n } },
    receiptFailure: { reads: { owner: account, getContractMintLimit: 4n } },
    confirm: (rare) => rare.listing.release.limits.setMint({ contract: nft, limit: 5n }),
    submit: (rare) => rare.listing.release.limits.setMint({ contract: nft, limit: 5n, waitForReceipt: false }),
  },
  {
    name: 'swap.buy (plain write)',
    receiptFailure: { receiptError: new Error('receipt polling timed out') },
    confirm: (rare) => rare.swap.buy({ token: nft, amountIn: 1n, minAmountOut: 1n, commands: '0x00', inputs: ['0x'] }),
    submit: (rare) => rare.swap.buy({
      token: nft,
      amountIn: 1n,
      minAmountOut: 1n,
      commands: '0x00',
      inputs: ['0x'],
      waitForReceipt: false,
    }),
  },
];

function connect(chain: ChainDouble): RareClient {
  return createRareClient({ publicClient: chain.publicClient, walletClient: chain.walletClient });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the promise to reject.');
    },
    (error: unknown) => error,
  );
}

describe.each(scenarios)('$name with waitForReceipt: false', (scenario) => {
  it('resolves once the main transaction is broadcast, after awaiting its approval', async () => {
    const chain = createChainDouble(scenario.options);

    const submitted = await scenario.submit(connect(chain));

    const approvalHashes = chain.approvalHashes();
    expect(approvalHashes).toHaveLength(scenario.approval === undefined ? 0 : 1);
    expect(chain.waitedHashes()).toEqual(approvalHashes);
    expect(submitted).toEqual({
      txHash: chain.mainHash(),
      ...(scenario.approval === undefined ? {} : { approvalTxHash: approvalHashes[0] }),
      wait: expect.any(Function),
    });
  });

  it('wait() returns the result the default mode returns for the same chain', async () => {
    const confirmed = await scenario.confirm(connect(createChainDouble(scenario.options)));
    const chain = createChainDouble(scenario.options);

    const submitted = await scenario.submit(connect(chain));

    await expect(submitted.wait()).resolves.toEqual(confirmed);
    expect(chain.waitedHashes()).toEqual([...chain.approvalHashes(), chain.mainHash()]);
  });

  it('surfaces receipt failures from wait() exactly as the default mode throws them', async () => {
    const options = { ...scenario.options, ...scenario.receiptFailure };
    const defaultError = await rejectionOf(scenario.confirm(connect(createChainDouble(options))));

    const submitted = await scenario.submit(connect(createChainDouble(options)));
    const waitError = await rejectionOf(submitted.wait());

    expect(waitError).toEqual(defaultError);
    expect(waitError).toBeInstanceOf(scenario.approval === undefined ? Error : ApprovalSideEffectError);
  });
});

describe('waitForReceipt: false around approvals', () => {
  it('still raises the approval side-effect alert when the main broadcast fails', async () => {
    const broadcastError = new Error('user rejected the bid');
    const chain = createChainDouble({
      reads: { marketplaceSettings, calculateMarketplaceFee: 30_000n },
      broadcastError,
    });

    const submission = connect(chain).auction.bid({
      contract: nft,
      tokenId: 1n,
      price: 1_000_000n,
      currency: 'usdc',
      waitForReceipt: false,
    });

    await expect(submission).rejects.toBeInstanceOf(ApprovalSideEffectError);
    await expect(submission).rejects.toMatchObject({ operation: 'auction bid', cause: broadcastError });
  });

  it('defers receipt-derived reads until wait()', async () => {
    const chain = createChainDouble({ reads: { owner: account, getContractMintLimit: 5n } });

    const submitted = await connect(chain).listing.release.limits.setMint({
      contract: nft,
      limit: 5n,
      waitForReceipt: false,
    });

    expect(chain.readFunctions()).toEqual(['owner']);
    await submitted.wait();
    expect(chain.readFunctions()).toEqual(['owner', 'getContractMintLimit']);
  });
});

describe('waitForReceipt typing', () => {
  it('keeps the default result type and narrows the submitted type on the literal flag', () => {
    const rare = connect(createChainDouble());
    const params = { contract: nft, tokenId: 1n, price: 1n };
    const calls = (waitForReceipt: boolean) => ({
      omitted: rare.auction.bid(params),
      waiting: rare.auction.bid({ ...params, waitForReceipt: true }),
      submitted: rare.auction.bid({ ...params, waitForReceipt: false }),
      dynamic: rare.auction.bid({ ...params, waitForReceipt }),
    });
    const returned = expectTypeOf(calls).returns;

    returned.toHaveProperty('omitted').resolves.toEqualTypeOf<AuctionBidResult>();
    returned.toHaveProperty('waiting').resolves.toEqualTypeOf<AuctionBidResult>();
    returned.toHaveProperty('submitted').resolves.toEqualTypeOf<SubmittedTransaction<AuctionBidResult>>();
    returned.toHaveProperty('dynamic').resolves.toEqualTypeOf<AuctionBidResult | SubmittedTransaction<AuctionBidResult>>();
    expectTypeOf<SubmittedTransaction<AuctionBidResult>['approvalTxHash']>().toEqualTypeOf<Hash | undefined>();
    expectTypeOf<keyof SubmittedTransaction<TransactionResult>>().toEqualTypeOf<'txHash' | 'wait'>();
    expectTypeOf<Awaited<ReturnType<RareClient['auction']['bid']>>>().toEqualTypeOf<AuctionBidResult>();
  });
});
