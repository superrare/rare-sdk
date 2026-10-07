import { vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  isAddressEqual,
  maxUint256,
  slice,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { sepolia } from 'viem/chains';

export const account: Address = '0x00000000000000000000000000000000000000A1';

const blockHash: Hash = `0x${'b'.repeat(64)}`;
const erc20ApproveSelector = toFunctionSelector('function approve(address spender, uint256 amount)');

export type MinedLog = Log<bigint, number, false>;

type ContractCall = {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
};

type PreparedTransaction = {
  to: Address;
  data: Hex;
};

type BroadcastCall = {
  address: Address;
  functionName: string;
};

type ChainEvent = BroadcastCall & {
  event: 'broadcast' | 'receipt';
  hash: Hash;
};

export type TimelineEvent = Pick<ChainEvent, 'event' | 'hash'>;

export type ChainDoubleOptions = {
  reads?: Readonly<Record<string, unknown>>;
  receiptLogs?: readonly MinedLog[];
  receiptStatus?: TransactionReceipt['status'];
  receiptError?: Error;
  broadcastError?: Error;
};

export type ChainDouble = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  mainHash: () => Hash;
  approvalHashes: () => Hash[];
  waitedHashes: () => Hash[];
  readFunctions: () => string[];
  timeline: () => TimelineEvent[];
};

export function transactionHash(index: number): Hash {
  return `0x${index.toString(16).padStart(64, '0')}`;
}

function isApproval(call: BroadcastCall): boolean {
  return call.functionName === 'approve' || call.functionName === 'setApprovalForAll';
}

function preparedFunctionName(data: Hex): string {
  const selector = slice(data, 0, 4);
  return selector === erc20ApproveSelector ? 'approve' : selector;
}

// Approval receipts settle a macrotask later, so a caller that broadcasts without awaiting them shows up in the timeline.
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createChainDouble(options: ChainDoubleOptions = {}): ChainDouble {
  const record = vi.fn<(event: ChainEvent) => void>();
  const broadcasts = (): ChainEvent[] => record.mock.calls
    .map(([event]) => event)
    .filter((event) => event.event === 'broadcast');
  const broadcastTransaction = (call: BroadcastCall): Hash => {
    if (options.broadcastError !== undefined && !isApproval(call)) {
      throw options.broadcastError;
    }
    const hash = transactionHash(broadcasts().length + 1);
    record({ address: call.address, functionName: call.functionName, event: 'broadcast', hash });
    return hash;
  };
  const hasBroadcast = (address: Address, functionName: string): boolean => broadcasts().some(
    (call) => call.functionName === functionName && isAddressEqual(call.address, address),
  );

  const readContract = vi.fn(async (call: ContractCall): Promise<unknown> => {
    if (call.functionName === 'allowance') {
      return hasBroadcast(call.address, 'approve') ? maxUint256 : 0n;
    }
    if (call.functionName === 'isApprovedForAll') {
      return hasBroadcast(call.address, 'setApprovalForAll');
    }
    if (options.reads !== undefined && call.functionName in options.reads) {
      return options.reads[call.functionName];
    }
    throw new Error(`Unexpected contract read: ${call.functionName}`);
  });

  const waitForTransactionReceipt = vi.fn(async ({ hash }: { hash: Hash }): Promise<TransactionReceipt> => {
    const transaction = broadcasts().find((call) => call.hash === hash);
    if (transaction === undefined) {
      throw new Error(`Unknown transaction ${hash}`);
    }
    if (isApproval(transaction)) {
      await nextMacrotask();
      record({ ...transaction, event: 'receipt' });
      return receipt(hash, [], 'success');
    }
    if (options.receiptError !== undefined) {
      throw options.receiptError;
    }
    record({ ...transaction, event: 'receipt' });
    return receipt(hash, options.receiptLogs ?? [], options.receiptStatus ?? 'success');
  });

  const publicClient = {
    chain: sepolia,
    readContract,
    waitForTransactionReceipt,
    simulateContract: vi.fn(async () => ({ result: undefined, request: {} })),
    estimateGas: vi.fn(async () => 21_000n),
  } as unknown as PublicClient;
  const walletClient = {
    account: { address: account, type: 'json-rpc' },
    writeContract: vi.fn(async (call: ContractCall): Promise<Hash> => broadcastTransaction(call)),
    sendTransaction: vi.fn(async (transaction: PreparedTransaction): Promise<Hash> => broadcastTransaction({
      address: transaction.to,
      functionName: preparedFunctionName(transaction.data),
    })),
  } as unknown as WalletClient;

  return {
    publicClient,
    walletClient,
    mainHash: () => {
      const main = broadcasts().find((call) => !isApproval(call));
      if (main === undefined) {
        throw new Error('No main transaction was broadcast.');
      }
      return main.hash;
    },
    approvalHashes: () => broadcasts().filter(isApproval).map((call) => call.hash),
    waitedHashes: () => waitForTransactionReceipt.mock.calls.map(([{ hash }]) => hash),
    readFunctions: () => readContract.mock.calls.map(([call]) => call.functionName),
    timeline: () => record.mock.calls.map(([{ event, hash }]) => ({ event, hash })),
  };
}

function receipt(hash: Hash, logs: readonly MinedLog[], status: TransactionReceipt['status']): TransactionReceipt {
  return {
    blockHash,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 21_000n,
    effectiveGasPrice: 1n,
    from: account,
    gasUsed: 21_000n,
    logs: logs.map((log) => ({ ...log, transactionHash: hash })),
    logsBloom: `0x${'0'.repeat(512)}`,
    status,
    to: null,
    transactionHash: hash,
    transactionIndex: 0,
    type: 'eip1559',
  };
}

export function eventLog(params: {
  address: Address;
  abi: Abi;
  eventName: string;
  args: Readonly<Record<string, unknown>>;
}): MinedLog {
  const event = params.abi.find((item): item is AbiEvent => item.type === 'event' && item.name === params.eventName);
  if (event === undefined) {
    throw new Error(`Unknown event ${params.eventName}`);
  }
  const argument = (name: string | undefined): unknown => params.args[name ?? ''];
  const indexed = event.inputs.filter((input) => input.indexed === true);
  const nonIndexed = event.inputs.filter((input) => input.indexed !== true);
  const [signature, ...indexedTopics] = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: Object.fromEntries(indexed.map((input) => [input.name, argument(input.name)])),
  }).filter((topic): topic is Hex => typeof topic === 'string');
  if (signature === undefined) {
    throw new Error(`Unable to encode ${params.eventName}`);
  }

  return {
    address: params.address,
    blockHash,
    blockNumber: 1n,
    data: encodeAbiParameters(nonIndexed, nonIndexed.map((input) => argument(input.name))),
    logIndex: 0,
    removed: false,
    topics: [signature, ...indexedTopics],
    transactionHash: blockHash,
    transactionIndex: 0,
  };
}
