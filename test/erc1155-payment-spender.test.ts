import { describe, expect, it, vi } from 'vitest';
import type { PublicClient, WalletClient } from 'viem';
import { getContractAddresses } from '../src/contracts/addresses.js';
import { createErc1155ListingNamespace } from '../src/sdk/erc1155.js';
import { PaymentApprovalRequiredError } from '../src/sdk/payments-shell.js';

const account = '0x0000000000000000000000000000000000000001' as const;
const contract = '0x0000000000000000000000000000000000000002' as const;
const seller = '0x0000000000000000000000000000000000000003' as const;
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;

describe('ERC1155 marketplace payments', () => {
  it('checks checkout ERC20 allowance against the approval manager', async () => {
    const addresses = getContractAddresses('mainnet');
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === 'calculateMarketplaceFee') return 0n;
      if (request.functionName === 'allowance') return 0n;
      throw new Error(`Unexpected contract read: ${request.functionName}`);
    });
    const simulateContract = vi.fn().mockResolvedValue({
      result: [
        [1n, 0n, 0n, 0n],
        [[0n, 1, contract, 1n, seller, usdc, 1_000_000n, 1n, true, 0, '0x', '0x', 1_000_000n]],
      ],
    });
    const publicClient = { readContract, simulateContract } as unknown as PublicClient;
    const walletClient = {
      account: { address: account },
      writeContract: vi.fn(),
    } as unknown as WalletClient;
    const listing = createErc1155ListingNamespace(
      publicClient,
      { publicClient, walletClient },
      'mainnet',
      addresses,
    );

    const checkout = listing.checkout({
      items: [{
        kind: 'listing',
        contract,
        seller,
        tokenId: 1n,
        quantity: 1n,
        price: 1_000_000n,
        currency: usdc,
      }],
      autoApprove: false,
    });

    await expect(checkout).rejects.toBeInstanceOf(PaymentApprovalRequiredError);
    await expect(checkout).rejects.toMatchObject({
      spenderAddress: addresses.erc20ApprovalManager,
      requiredAmount: 1_000_000n,
    });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: usdc,
      functionName: 'allowance',
      args: [account, addresses.erc20ApprovalManager],
    }));
  });
});
