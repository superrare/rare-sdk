import { beforeEach, describe, expect, it, vi } from 'vitest';
import { base } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';

const walletActions = vi.hoisted(() => ({
  sendCalls: vi.fn(),
  waitForCallsStatus: vi.fn(),
}));

vi.mock('viem/actions', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem/actions')>(),
  ...walletActions,
}));

import { createWalletClientWithCallsFallback } from '../src/sdk/transaction-fallback-shell.js';

const contractAddress = '0x0000000000000000000000000000000000000001';
const account = '0x0000000000000000000000000000000000000002';
const transactionHash = `0x${'1'.repeat(64)}` as const;
const approvalAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [],
}] as const;

describe('createWalletClientWithCallsFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes the original contract request and returns the bundle receipt hash', async () => {
    const writeContract = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = {
      writeContract,
      marker: 'preserved',
    } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });

    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );
    const result = await wallet.writeContract({
      address: contractAddress,
      abi: approvalAbi,
      functionName: 'approve',
      args: [account, 42n],
      account,
      chain: undefined,
    });

    expect(result).toBe(transactionHash);
    expect(writeContract).toHaveBeenCalledOnce();
    expect(walletActions.sendCalls).toHaveBeenCalledWith(originalWallet, {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: `0x095ea7b30000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002a`,
        value: undefined,
      }],
    });
    expect(walletActions.waitForCallsStatus).toHaveBeenCalledWith(originalWallet, {
      id: 'bundle-id',
      throwOnFailure: true,
    });
    expect(Reflect.get(wallet, 'marker')).toBe('preserved');
  });

  it('reports the missing-chain precondition only after the matching failure', async () => {
    const originalError = new Error('Cannot convert eip155:8453 to a BigInt');
    const wallet = createWalletClientWithCallsFallback(
      { chain: undefined } as PublicClient,
      { writeContract: vi.fn().mockRejectedValue(originalError) } as unknown as WalletClient,
    );

    const result = wallet.writeContract({
      address: contractAddress,
      abi: approvalAbi,
      functionName: 'approve',
      args: [account, 42n],
      account,
      chain: undefined,
    });
    await expect(result).rejects.toThrow(
      'The Reown social-wallet fallback requires a public client with an explicit chain.',
    );
    await expect(result).rejects.toMatchObject({ cause: originalError });
    expect(walletActions.sendCalls).not.toHaveBeenCalled();
  });

  it('covers the SDK known-calldata sendTransaction path and preserves value', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = { sendTransaction } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });
    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );

    await expect(wallet.sendTransaction({
      account,
      chain: undefined,
      to: contractAddress,
      data: '0x1234',
      value: 42n,
    })).resolves.toBe(transactionHash);
    expect(walletActions.sendCalls).toHaveBeenCalledWith(originalWallet, {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: '0x1234',
        value: 42n,
      }],
    });
  });
});
