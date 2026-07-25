import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { createRareClient } from '../src/sdk/client.js';

const account = '0x0000000000000000000000000000000000000002';
const contractAddress = '0x0000000000000000000000000000000000000001';
const transactionHash = `0x${'1'.repeat(64)}` as const;
const blockHash = `0x${'2'.repeat(64)}` as const;
const recipient = '0x0000000000000000000000000000000000000003';
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

describe('createRareClient transaction fallback integration', () => {
  it('routes a real Viem wrapped error through the decorated public SDK wallet', async () => {
    const walletRequest = vi.fn(async ({ method }: { method: string }) => {
      switch (method) {
        case 'eth_chainId':
          return '0x2105';
        case 'eth_sendTransaction':
          throw new TypeError('Cannot convert eip155:8453 to a BigInt');
        case 'wallet_sendCalls':
          return '0x1234';
        case 'wallet_getCallsStatus':
          return {
            atomic: true,
            chainId: '0x2105',
            receipts: [{
              blockNumber: '0x1',
              gasUsed: '0x5208',
              status: '0x1',
              transactionHash,
            }],
            status: 200,
            version: '2.0.0',
          };
        default:
          throw new Error(`Unexpected wallet RPC method: ${method}`);
      }
    });
    const publicRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method !== 'eth_getTransactionReceipt') {
        throw new Error(`Unexpected public RPC method: ${method}`);
      }

      return {
        blockHash,
        blockNumber: '0x1',
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        effectiveGasPrice: '0x1',
        from: account,
        gasUsed: '0x5208',
        logs: [],
        logsBloom: `0x${'0'.repeat(512)}`,
        status: '0x1',
        to: contractAddress,
        transactionHash,
        transactionIndex: '0x0',
        type: '0x2',
      };
    });
    const publicClient = createPublicClient({
      chain: base,
      transport: custom({ request: publicRequest }),
    });
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: custom({ request: walletRequest }),
    });
    const rare = createRareClient({
      publicClient: publicClient as unknown as PublicClient,
      walletClient,
    });

    const result = await rare.offer.cancel({
      contract: contractAddress,
      tokenId: 1n,
    });
    const transferResult = await rare.nft.transfer.erc721({
      contract: contractAddress,
      tokenId: 7n,
      to: recipient,
    });
    const erc1155TransferResult = await rare.nft.transfer.erc1155({
      contract: contractAddress,
      tokenId: 8n,
      quantity: 3n,
      to: recipient,
    });

    expect(result.txHash).toBe(transactionHash);
    expect(transferResult.txHash).toBe(transactionHash);
    expect(erc1155TransferResult.txHash).toBe(transactionHash);
    expect(walletRequest.mock.calls.map(([request]) => request.method)).toEqual([
      'eth_chainId',
      'eth_sendTransaction',
      'wallet_sendCalls',
      'wallet_getCallsStatus',
      'eth_chainId',
      'eth_sendTransaction',
      'wallet_sendCalls',
      'wallet_getCallsStatus',
      'eth_chainId',
      'eth_sendTransaction',
      'wallet_sendCalls',
      'wallet_getCallsStatus',
    ]);
    expect(publicRequest).toHaveBeenCalledTimes(3);
    expect(publicRequest).toHaveBeenLastCalledWith({
      method: 'eth_getTransactionReceipt',
      params: [transactionHash],
    }, undefined);
    const transferFallbackRequest = walletRequest.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'wallet_sendCalls')[1];
    expect(transferFallbackRequest).toMatchObject({
      method: 'wallet_sendCalls',
      params: [{
        calls: [{
          to: contractAddress,
          data: encodeFunctionData({
            abi: erc721TransferAbi,
            functionName: 'safeTransferFrom',
            args: [account, recipient, 7n, '0x'],
          }),
        }],
      }],
    });
    const erc1155TransferFallbackRequest = walletRequest.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === 'wallet_sendCalls')[2];
    expect(erc1155TransferFallbackRequest).toMatchObject({
      method: 'wallet_sendCalls',
      params: [{
        calls: [{
          to: contractAddress,
          data: encodeFunctionData({
            abi: erc1155TransferAbi,
            functionName: 'safeTransferFrom',
            args: [account, recipient, 8n, 3n, '0x'],
          }),
        }],
      }],
    });
  });
});
