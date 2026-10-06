import { vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  maxUint256,
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

export type MinedLog = Log<bigint, number, false>;

type ContractCall = {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
};

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
};

export function transactionHash(index: number): Hash {
  return `0x${index.toString(16).padStart(64, '0')}`;
}

function isApproval(call: ContractCall): boolean {
  return call.functionName === 'approve' || call.functionName === 'setApprovalForAll';
}

export function createChainDouble(options: ChainDoubleOptions = {}): ChainDouble {
  const writeContract = vi.fn(async (call: ContractCall): Promise<Hash> => {
    if (options.broadcastError !== undefined && !isApproval(call)) {
      throw options.broadcastError;
    }
    return transactionHash(writeContract.mock.calls.length);
  });
  const broadcasts = (): (ContractCall & { hash: Hash })[] => writeContract.mock.calls.map(([call], index) => ({
    ...call,
    hash: transactionHash(index + 1),
  }));
  const hasBroadcast = (functionName: string): boolean => broadcasts().some((call) => call.functionName === functionName);

  const readContract = vi.fn(async (call: ContractCall): Promise<unknown> => {
    if (call.functionName === 'allowance') {
      return hasBroadcast('approve') ? maxUint256 : 0n;
    }
    if (call.functionName === 'isApprovedForAll') {
      return hasBroadcast('setApprovalForAll');
    }
    if (options.reads !== undefined && call.functionName in options.reads) {
      return options.reads[call.functionName];
    }
    throw new Error(`Unexpected contract read: ${call.functionName}`);
  });

  const waitForTransactionReceipt = vi.fn(async ({ hash }: { hash: Hash }): Promise<TransactionReceipt> => {
    const broadcast = broadcasts().find((call) => call.hash === hash);
    if (broadcast === undefined) {
      throw new Error(`Unknown transaction ${hash}`);
    }
    if (isApproval(broadcast)) {
      return receipt(hash, [], 'success');
    }
    if (options.receiptError !== undefined) {
      throw options.receiptError;
    }
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
    writeContract,
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
