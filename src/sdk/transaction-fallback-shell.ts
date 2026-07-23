import {
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { sendCalls, waitForCallsStatus } from 'viem/actions';
import {
  getCallsTransactionHash,
  isCaipChainIdConversionError,
  resolveTransactionData,
} from './transaction-fallback-core.js';

export type FallbackCall = {
  readonly to: Address;
  readonly data?: Hex;
  readonly value?: bigint;
};

type EncodableContractCall = {
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: unknown;
};

type CallsResult = {
  readonly bundleId: string;
  readonly receipts: readonly { transactionHash: Hash }[];
};

/** Imperative boundary around a normal wallet action and its single fallback. */
export async function executeWithCallsFallback(params: {
  readonly call: FallbackCall;
  readonly executePrimary: () => Promise<Hash>;
  readonly sendCalls: (call: FallbackCall, primaryError: unknown) => Promise<CallsResult>;
}): Promise<Hash> {
  try {
    return await params.executePrimary();
  } catch (error) {
    if (!isCaipChainIdConversionError(error)) {
      throw error;
    }

    const result = await params.sendCalls(params.call, error);
    return getCallsTransactionHash(result);
  }
}

/**
 * Decorates the wallet once at the SDK boundary so every contract write uses
 * the same fallback policy while retaining viem's call-site type inference.
 */
export function createWalletClientWithCallsFallback<Wallet extends WalletClient>(
  publicClient: PublicClient,
  walletClient: Wallet,
): Wallet {
  const callsWalletClient = withoutDataSuffix(walletClient);
  const writeContract: WalletClient['writeContract'] = async (parameters) => {
    const encodedData = encodeContractCall(parameters);
    const data = resolveTransactionData({
      data: encodedData,
      requestDataSuffix: parameters.dataSuffix,
      clientDataSuffix: walletClient.dataSuffix,
    });

    return executeWalletActionWithCallsFallback({
      publicClient,
      callsWalletClient,
      receiptWalletClient: walletClient,
      account: parameters.account,
      call: {
        to: parameters.address,
        data,
        value: parameters.value,
      },
      executePrimary: () => walletClient.writeContract(parameters),
    });
  };

  const sendTransaction: WalletClient['sendTransaction'] = async (parameters) => {
    if (parameters.to == null) {
      return walletClient.sendTransaction(parameters);
    }

    return executeWalletActionWithCallsFallback({
      publicClient,
      callsWalletClient,
      receiptWalletClient: walletClient,
      account: parameters.account,
      call: {
        to: parameters.to,
        data: resolveTransactionData({
          data: parameters.data,
          requestDataSuffix: parameters.dataSuffix,
          clientDataSuffix: walletClient.dataSuffix,
        }),
        value: parameters.value,
      },
      executePrimary: () => walletClient.sendTransaction(parameters),
    });
  };

  return new Proxy(walletClient, {
    get(target, property, receiver) {
      if (property === 'writeContract') {
        return writeContract;
      }
      if (property === 'sendTransaction') {
        return sendTransaction;
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function withoutDataSuffix<Wallet extends WalletClient>(walletClient: Wallet): Wallet {
  return new Proxy(walletClient, {
    get(target, property, receiver) {
      return property === 'dataSuffix'
        ? undefined
        : Reflect.get(target, property, receiver);
    },
  });
}

function encodeContractCall(parameters: EncodableContractCall): Hex {
  return Array.isArray(parameters.args)
    ? encodeFunctionData({
        abi: parameters.abi,
        functionName: parameters.functionName,
        args: parameters.args,
      })
    : encodeFunctionData({
        abi: parameters.abi,
        functionName: parameters.functionName,
      });
}

async function executeWalletActionWithCallsFallback(params: {
  readonly publicClient: PublicClient;
  readonly callsWalletClient: WalletClient;
  readonly receiptWalletClient: WalletClient;
  readonly account: Parameters<WalletClient['sendCalls']>[0]['account'];
  readonly call: FallbackCall;
  readonly executePrimary: () => Promise<Hash>;
}): Promise<Hash> {
  return executeWithCallsFallback({
    call: params.call,
    executePrimary: params.executePrimary,
    sendCalls: async (call, primaryError) => {
      const chain = params.publicClient.chain;
      if (chain === undefined) {
        throw new Error(
          'The Reown social-wallet fallback requires a public client with an explicit chain.',
          { cause: primaryError },
        );
      }

      const { id } = await sendCalls(params.callsWalletClient, {
        account: params.account,
        chain,
        calls: [call],
      });
      const status = await waitForCallsStatus(params.receiptWalletClient, {
        id,
        throwOnFailure: true,
      });

      return {
        bundleId: id,
        receipts: status.receipts ?? [],
      };
    },
  });
}
