import { describe, expect, it, vi } from 'vitest';
import type { PublicClient, TransactionReceipt, WalletClient } from 'viem';
import { createRareClient } from '../src/sdk/client.js';
import { createNftTransferNamespace } from '../src/sdk/nft.js';

const contract = '0x0000000000000000000000000000000000000001';
const account = '0x0000000000000000000000000000000000000002';
const recipient = '0x0000000000000000000000000000000000000003';
const owner = '0x0000000000000000000000000000000000000004';
const txHash = `0x${'1'.repeat(64)}` as const;
const receipt = { status: 'success' } as TransactionReceipt;

function setup() {
  const writeContract = vi.fn().mockResolvedValue(txHash);
  const waitForTransactionReceipt = vi.fn().mockResolvedValue(receipt);
  const transfer = createNftTransferNamespace(
    { waitForTransactionReceipt } as unknown as PublicClient,
    {
      publicClient: {} as PublicClient,
      walletClient: { writeContract } as unknown as WalletClient,
      account,
    },
  );
  return { transfer, writeContract, waitForTransactionReceipt };
}

describe('NFT transfers', () => {
  it('exposes both transfer standards on the public client', () => {
    const rare = createRareClient({
      publicClient: { chain: { id: 8453 } } as PublicClient,
    });

    expect(typeof rare.nft.transfer.erc721).toBe('function');
    expect(typeof rare.nft.transfer.erc1155).toBe('function');
  });

  it('safely transfers an ERC-721 from the configured account', async () => {
    const { transfer, writeContract, waitForTransactionReceipt } = setup();

    await expect(transfer.erc721({
      contract,
      tokenId: '7',
      to: recipient,
    })).resolves.toEqual({
      txHash,
      receipt,
      contract,
      tokenId: 7n,
      from: account,
      to: recipient,
      data: '0x',
    });
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: contract,
      functionName: 'safeTransferFrom',
      args: [account, recipient, 7n, '0x'],
      account,
      chain: undefined,
    }));
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
  });

  it('safely transfers an ERC-1155 quantity on behalf of an explicit owner', async () => {
    const { transfer, writeContract } = setup();

    await expect(transfer.erc1155({
      contract,
      tokenId: 9,
      quantity: '5',
      from: owner,
      to: recipient,
      data: '0xabcd',
    })).resolves.toEqual({
      txHash,
      receipt,
      contract,
      tokenId: 9n,
      quantity: 5n,
      from: owner,
      to: recipient,
      data: '0xabcd',
    });
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: contract,
      functionName: 'safeTransferFrom',
      args: [owner, recipient, 9n, 5n, '0xabcd'],
      account,
      chain: undefined,
    }));
  });

  it('rejects a reverted transfer receipt', async () => {
    const { transfer, waitForTransactionReceipt } = setup();
    waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' } as TransactionReceipt);

    await expect(transfer.erc721({
      contract,
      tokenId: 1,
      to: recipient,
    })).rejects.toThrow(`erc721 transfer transaction ${txHash} was mined with status "reverted"`);
  });
});
