import { assert, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Hash } from 'viem';
import { ApprovalSideEffectError, createApprovalSideEffectAlert } from '../src/sdk/approvals-shell.js';
import { defineTransactionMethod, resolvePendingTransaction } from '../src/sdk/transaction-submission.js';
import type { SubmittedTransaction, WaitForReceiptOption } from '../src/sdk/index.js';

const txHash: Hash = `0x${'1'.repeat(64)}`;
const approvalTxHash: Hash = `0x${'2'.repeat(64)}`;
const token: Hash = `0x${'3'.repeat(64)}`;

type MintParams = { tokenUri: string };
type MintResult = { txHash: Hash; approvalTxHash?: Hash; tokenId: bigint };

const mintResult: MintResult = { txHash, approvalTxHash, tokenId: 7n };

function mintMethod(settle: (params: MintParams) => Promise<MintResult>) {
  const submit = vi.fn(async (params: MintParams) => ({
    submitted: { txHash, approvalTxHash },
    settle: () => settle(params),
  }));
  return { submit, mint: defineTransactionMethod<MintParams, MintResult>(submit) };
}

describe('resolvePendingTransaction', () => {
  it.each([undefined, true])('settles before resolving when waitForReceipt is %s', async (waitForReceipt) => {
    const settle = vi.fn(async () => mintResult);

    const resolved = await resolvePendingTransaction({ submitted: { txHash, approvalTxHash }, settle }, waitForReceipt);

    expect(resolved).toBe(mintResult);
    expect(settle).toHaveBeenCalledOnce();
  });

  it('returns only the submitted fields and a wait() that settles when waitForReceipt is false', async () => {
    const settle = vi.fn(async () => mintResult);

    const resolved = await resolvePendingTransaction({ submitted: { txHash, approvalTxHash }, settle }, false);

    expect(settle).not.toHaveBeenCalled();
    expect(resolved).toEqual({ txHash, approvalTxHash, wait: settle });
  });
});

describe('defineTransactionMethod', () => {
  it('waits for the settled result by default and with waitForReceipt: true', async () => {
    const settle = vi.fn(async (params: MintParams) => ({ ...mintResult, tokenId: BigInt(params.tokenUri.length) }));
    const { mint } = mintMethod(settle);

    await expect(mint({ tokenUri: 'ipfs://a' })).resolves.toEqual({ ...mintResult, tokenId: 8n });
    await expect(mint({ tokenUri: 'ipfs://a', waitForReceipt: true })).resolves.toEqual({ ...mintResult, tokenId: 8n });
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it('resolves with the transaction hash and approval hashes before settling when waitForReceipt is false', async () => {
    const settle = vi.fn(async () => mintResult);
    const { mint, submit } = mintMethod(settle);

    const submitted = await mint({ tokenUri: 'ipfs://a', waitForReceipt: false });

    expectTypeOf(submitted).toEqualTypeOf<SubmittedTransaction<MintResult>>();
    expect(submit).toHaveBeenCalledWith({ tokenUri: 'ipfs://a', waitForReceipt: false });
    expect(settle).not.toHaveBeenCalled();
    expect(submitted.txHash).toBe(txHash);
    expect(submitted.approvalTxHash).toBe(approvalTxHash);
    await expect(submitted.wait()).resolves.toBe(mintResult);
    await expect(submitted.wait()).resolves.toBe(mintResult);
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it('keeps the flag and params given at the call when the caller mutates them while the broadcast is pending', async () => {
    const settle = vi.fn(async (params: MintParams) => ({ ...mintResult, tokenId: BigInt(params.tokenUri.length) }));
    const { mint } = mintMethod(settle);
    const params: MintParams & WaitForReceiptOption = { tokenUri: 'ipfs://a', waitForReceipt: false };

    const pending = mint(params);
    /* eslint-disable functional/immutable-data -- the scenario is a caller mutating its own params */
    params.waitForReceipt = true;
    params.tokenUri = 'ipfs://changed-after-the-call';
    /* eslint-enable functional/immutable-data */
    const submitted = await pending;

    expect(settle).not.toHaveBeenCalled();
    assert('wait' in submitted);
    await expect(submitted.wait()).resolves.toEqual({ ...mintResult, tokenId: 8n });
  });

  it('surfaces settle failures from wait() and from the default call', async () => {
    const failure = new Error('transaction reverted');
    const { mint } = mintMethod(async () => {
      throw failure;
    });

    const submitted = await mint({ tokenUri: 'ipfs://a', waitForReceipt: false });

    await expect(submitted.wait()).rejects.toBe(failure);
    await expect(mint({ tokenUri: 'ipfs://a' })).rejects.toBe(failure);
  });

  it('rejects in both modes when the broadcast fails', async () => {
    const failure = new Error('user rejected the request');
    const mint = defineTransactionMethod<MintParams, MintResult>(async () => {
      throw failure;
    });

    await expect(mint({ tokenUri: 'ipfs://a', waitForReceipt: false })).rejects.toBe(failure);
    await expect(mint({ tokenUri: 'ipfs://a' })).rejects.toBe(failure);
  });
});

describe('createApprovalSideEffectAlert', () => {
  const approval = { type: 'erc20' as const, approvalTxHash, target: token, spender: token };
  const approvals = [approval];

  it('returns the guarded result', async () => {
    const withApprovalAlert = createApprovalSideEffectAlert({ operation: 'listing buy', approvals });

    await expect(withApprovalAlert(async () => txHash)).resolves.toBe(txHash);
  });

  it('reports the mined approval when the guarded step fails', async () => {
    const failure = new Error('transaction reverted');
    const withApprovalAlert = createApprovalSideEffectAlert({ operation: 'listing buy', approvals });

    const guarded = withApprovalAlert(async () => {
      throw failure;
    });

    await expect(guarded).rejects.toBeInstanceOf(ApprovalSideEffectError);
    await expect(guarded).rejects.toMatchObject({ operation: 'listing buy', approvals, cause: failure });
  });

  it('rethrows the original failure when no approval was sent', async () => {
    const failure = new Error('transaction reverted');
    const withApprovalAlert = createApprovalSideEffectAlert({
      operation: 'listing buy',
      approvals: [{ ...approval, approvalTxHash: undefined }],
    });

    await expect(withApprovalAlert(async () => {
      throw failure;
    })).rejects.toBe(failure);
  });
});
