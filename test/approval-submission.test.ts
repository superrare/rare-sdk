import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { batchAuctionHouseAbi } from '../src/contracts/abis/batch-auctionhouse.js';
import { ETH_ADDRESS, getContractAddresses } from '../src/contracts/addresses.js';
import { buildBatchTokenTreeArtifact } from '../src/sdk/batch-core.js';
import { createRareClient } from '../src/sdk/client.js';
import type {
  BatchAuctionCreateParams,
  RareClient,
  TokenTradeQuoteParams,
} from '../src/sdk/index.js';
import {
  account,
  createChainDouble,
  eventLog,
  type ChainDouble,
  type ChainDoubleOptions,
  type TimelineEvent,
} from './support/chain-double.js';

const addresses = getContractAddresses('sepolia');
const nft: Address = '0x00000000000000000000000000000000000000C1';
const secondNft: Address = '0x00000000000000000000000000000000000000c2';
const marketplaceSettings: Address = '0x00000000000000000000000000000000000000E1';
const soldToken: Address = '0x00000000000000000000000000000000000000F1';
const permit2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const universalRouter: Address = '0x00000000000000000000000000000000000000B1';

function connect(chain: ChainDouble): RareClient {
  return createRareClient({ publicClient: chain.publicClient, walletClient: chain.walletClient });
}

function confirmedBeforeBroadcast(prerequisites: readonly Hash[], txHash: Hash): TimelineEvent[] {
  return [
    ...prerequisites.flatMap((hash): TimelineEvent[] => [
      { event: 'broadcast', hash },
      { event: 'receipt', hash },
    ]),
    { event: 'broadcast', hash: txHash },
  ];
}

type OrderingScenario = {
  name: string;
  options?: ChainDoubleOptions;
  submit: (rare: RareClient) => Promise<{ txHash: Hash; approvalTxHash?: Hash }>;
};

const orderingScenarios: OrderingScenario[] = [
  {
    name: 'auction.bid (ERC20 approval)',
    options: { reads: { marketplaceSettings, calculateMarketplaceFee: 30_000n } },
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
    submit: (rare) => rare.listing.create({ contract: nft, tokenId: 1n, price: 1n, waitForReceipt: false }),
  },
];

describe.each(orderingScenarios)('$name with waitForReceipt: false', (scenario) => {
  it('broadcasts the main transaction only after the approval receipt resolved', async () => {
    const chain = createChainDouble(scenario.options);

    const submitted = await scenario.submit(connect(chain));

    const approvalTxHashes = chain.approvalHashes();
    expect(approvalTxHashes).toEqual([submitted.approvalTxHash]);
    expect(chain.timeline()).toEqual(confirmedBeforeBroadcast(approvalTxHashes, submitted.txHash));
  });
});

const batchTokenList = buildBatchTokenTreeArtifact({
  content: JSON.stringify([
    { contractAddress: nft, tokenId: '1' },
    { contractAddress: secondNft, tokenId: '2' },
  ]),
  format: 'json',
});

const batchAuctionCreate: BatchAuctionCreateParams = {
  artifact: batchTokenList,
  root: batchTokenList.root,
  price: 1n,
  endTime: 4_102_444_800n,
};

const batchAuctionChain: ChainDoubleOptions = {
  receiptLogs: [eventLog({
    address: addresses.batchAuctionHouse ?? zeroAddress,
    abi: batchAuctionHouseAbi,
    eventName: 'AuctionMerkleRootRegistered',
    args: {
      creator: account,
      merkleRoot: batchTokenList.root,
      currencyAddress: ETH_ADDRESS,
      startingAmount: 1n,
      duration: 3_600n,
      nonce: 1,
    },
  })],
};

describe('auction.batch.create across several NFT contracts with waitForReceipt: false', () => {
  it('returns every approval hash in broadcast order once each approval receipt resolved', async () => {
    const chain = createChainDouble(batchAuctionChain);

    const submitted = await connect(chain).auction.batch.create({ ...batchAuctionCreate, waitForReceipt: false });

    const approvalTxHashes = chain.approvalHashes();
    expect(approvalTxHashes).toHaveLength(2);
    expect(submitted).toEqual({
      txHash: chain.mainHash(),
      approvalTxHashes,
      wait: expect.any(Function),
    });
    expect(chain.timeline()).toEqual(confirmedBeforeBroadcast(approvalTxHashes, submitted.txHash));
  });

  it('wait() returns the result the default mode returns for the same chain', async () => {
    const confirmed = await connect(createChainDouble(batchAuctionChain)).auction.batch.create(batchAuctionCreate);
    const chain = createChainDouble(batchAuctionChain);

    const submitted = await connect(chain).auction.batch.create({ ...batchAuctionCreate, waitForReceipt: false });

    expect(confirmed.approvalTxHashes).toHaveLength(2);
    await expect(submitted.wait()).resolves.toEqual(confirmed);
  });
});

function preparedTransaction(to: Address, data: Hex) {
  return { to, from: account, data, value: '0', chainId: sepolia.id };
}

const uniswapResponses: Readonly<Record<string, unknown>> = {
  '/quote': {
    requestId: 'quote-request',
    routing: 'CLASSIC',
    quote: {
      chainId: sepolia.id,
      input: { amount: '1000', token: soldToken },
      output: { amount: '500', token: ETH_ADDRESS, recipient: account },
      swapper: account,
      route: [],
      slippage: 0.5,
      tradeType: 'EXACT_INPUT',
      quoteId: 'quote-id',
    },
    permitData: null,
  },
  '/check_approval': {
    requestId: 'approval-request',
    cancel: preparedTransaction(
      soldToken,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [permit2, 0n] }),
    ),
    approval: preparedTransaction(
      soldToken,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [permit2, maxUint256] }),
    ),
  },
  '/swap': {
    requestId: 'swap-request',
    swap: preparedTransaction(
      universalRouter,
      encodeFunctionData({
        abi: parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)']),
        functionName: 'execute',
        args: ['0x00', ['0x'], 1n],
      }),
    ),
  },
};

async function uniswapApi(url: string | URL): Promise<Response> {
  const path = Object.keys(uniswapResponses).find((suffix) => String(url).endsWith(suffix));
  if (path === undefined) {
    throw new Error(`Unexpected Uniswap API request: ${String(url)}`);
  }
  return new Response(JSON.stringify(uniswapResponses[path]));
}

function connectWithUniswap(chain: ChainDouble): RareClient {
  return createRareClient({
    publicClient: chain.publicClient,
    walletClient: chain.walletClient,
    uniswapApiKey: 'test-uniswap-api-key',
  });
}

const uniswapSell: TokenTradeQuoteParams = { token: soldToken, amountIn: 1_000n, route: 'uniswap' };
const uniswapSellChain: ChainDoubleOptions = { reads: { decimals: 18 } };

describe('swap.sellToken through the Uniswap API with an allowance reset and waitForReceipt: false', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(uniswapApi));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the reset, approval and swap hashes once both prerequisite receipts resolved', async () => {
    const chain = createChainDouble(uniswapSellChain);

    const submitted = await connectWithUniswap(chain).swap.sellToken({ ...uniswapSell, waitForReceipt: false });

    const prerequisites = chain.approvalHashes();
    const [approvalResetTxHash, approvalTxHash] = prerequisites;
    expect(prerequisites).toHaveLength(2);
    expect(submitted).toEqual({
      txHash: chain.mainHash(),
      approvalTxHash,
      approvalResetTxHash,
      wait: expect.any(Function),
    });
    expect(chain.timeline()).toEqual(confirmedBeforeBroadcast(prerequisites, submitted.txHash));
  });

  it('wait() returns the result the default mode returns for the same chain', async () => {
    const confirmed = await connectWithUniswap(createChainDouble(uniswapSellChain)).swap.sellToken(uniswapSell);
    const chain = createChainDouble(uniswapSellChain);

    const submitted = await connectWithUniswap(chain).swap.sellToken({ ...uniswapSell, waitForReceipt: false });

    expect(confirmed).toMatchObject({
      execution: 'uniswap-api',
      approvalTxHash: expect.any(String),
      approvalResetTxHash: expect.any(String),
    });
    await expect(submitted.wait()).resolves.toEqual(confirmed);
  });
});
