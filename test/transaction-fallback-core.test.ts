import { describe, expect, it } from 'vitest';
import {
  getCallsTransactionHash,
  isCaipChainIdConversionError,
  resolveTransactionData,
} from '../src/sdk/transaction-fallback-core.js';

describe('isCaipChainIdConversionError', () => {
  it.each([
    'Cannot convert eip155:1 to a BigInt',
    { message: 'Cannot convert eip155:8453 to a BigInt' },
    { details: 'Cannot convert eip155:11155111 to a BigInt' },
    { shortMessage: 'Cannot convert eip155:84532 to a BigInt' },
    { cause: { cause: { message: 'Cannot convert eip155:1 to a BigInt' } } },
  ])('recognizes the Reown CAIP-2 conversion failure in %j', (error) => {
    expect(isCaipChainIdConversionError(error)).toBe(true);
  });

  it.each([
    new Error('User rejected the request'),
    new Error('execution reverted'),
    new Error('insufficient funds'),
    new Error('Cannot convert solana:mainnet to a BigInt'),
    new Error('Cannot convert eip155:not-a-number to a BigInt'),
    null,
  ])('does not recognize unrelated failures in %j', (error) => {
    expect(isCaipChainIdConversionError(error)).toBe(false);
  });

  it('stops following cyclic causes', () => {
    const error = createCyclicError();

    expect(isCaipChainIdConversionError(error)).toBe(false);
  });
});

function createCyclicError(): unknown {
  const error = {
    message: 'unrelated',
    get cause(): unknown {
      return error;
    },
  };
  return error;
}

describe('getCallsTransactionHash', () => {
  it('returns the first receipt transaction hash', () => {
    expect(getCallsTransactionHash({
      bundleId: 'bundle-id',
      receipts: [{ transactionHash: '0x123' }],
    })).toBe('0x123');
  });

  it('rejects a completed bundle without a transaction receipt', () => {
    expect(() => getCallsTransactionHash({
      bundleId: 'bundle-id',
      receipts: [],
    })).toThrow('sendCalls bundle bundle-id completed without a transaction receipt.');
  });
});

describe('resolveTransactionData', () => {
  it('uses an explicit request suffix instead of the client suffix', () => {
    expect(resolveTransactionData({
      data: '0x1234',
      requestDataSuffix: '0xabcd',
      clientDataSuffix: { value: '0xffff', required: true },
    })).toBe('0x1234abcd');
  });

  it('uses a string client suffix when the request does not override it', () => {
    expect(resolveTransactionData({
      data: '0x1234',
      clientDataSuffix: '0xabcd',
    })).toBe('0x1234abcd');
  });

  it('supports a suffix-only transaction', () => {
    expect(resolveTransactionData({
      requestDataSuffix: '0xabcd',
    })).toBe('0xabcd');
  });

  it('preserves absent data when there is no effective suffix', () => {
    expect(resolveTransactionData({})).toBeUndefined();
  });
});
