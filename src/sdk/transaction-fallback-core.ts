import { concatHex, type DataSuffix, type Hash, type Hex } from 'viem';

const caipChainIdConversionPattern = /Cannot convert eip155:\d+ to a BigInt/i;
const maxCauseDepth = 10;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Identifies the CAIP-2 chain-id conversion failure emitted by Reown social
 * wallets. This deliberately excludes all ordinary wallet and RPC failures.
 */
export function isCaipChainIdConversionError(error: unknown, depth = 0): boolean {
  if (depth > maxCauseDepth) {
    return false;
  }

  if (typeof error === 'string') {
    return caipChainIdConversionPattern.test(error);
  }

  if (!isRecord(error)) {
    return false;
  }

  const messages = [error.message, error.details, error.shortMessage];
  if (messages.some((message) => (
    typeof message === 'string' && caipChainIdConversionPattern.test(message)
  ))) {
    return true;
  }

  return isCaipChainIdConversionError(error.cause, depth + 1);
}

export function getCallsTransactionHash(params: {
  bundleId: string;
  receipts: readonly { transactionHash: Hash }[];
}): Hash {
  const transactionHash = params.receipts[0]?.transactionHash;
  if (transactionHash === undefined) {
    throw new Error(
      `sendCalls bundle ${params.bundleId} completed without a transaction receipt.`,
    );
  }

  return transactionHash;
}

/** Resolves Viem's request-over-client suffix precedence and applies it once. */
export function resolveTransactionData(params: {
  readonly data?: Hex;
  readonly requestDataSuffix?: Hex;
  readonly clientDataSuffix?: DataSuffix;
}): Hex | undefined {
  const clientDataSuffix = typeof params.clientDataSuffix === 'string'
    ? params.clientDataSuffix
    : params.clientDataSuffix?.value;
  const dataSuffix = params.requestDataSuffix ?? clientDataSuffix;

  return dataSuffix === undefined
    ? params.data
    : concatHex([params.data ?? '0x', dataSuffix]);
}
