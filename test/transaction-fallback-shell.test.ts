import { describe, expect, it, vi } from 'vitest';
import { executeWithCallsFallback } from '../src/sdk/transaction-fallback-shell.js';

const call = {
  to: '0x0000000000000000000000000000000000000001' as const,
  data: '0x1234' as const,
  value: 42n,
};

describe('executeWithCallsFallback', () => {
  it('returns the primary transaction hash without invoking the fallback', async () => {
    const sendCalls = vi.fn();

    await expect(executeWithCallsFallback({
      call,
      executePrimary: vi.fn().mockResolvedValue('0xprimary'),
      sendCalls,
    })).resolves.toBe('0xprimary');
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it('retries the exact Reown failure once through sendCalls', async () => {
    const executePrimary = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const sendCalls = vi.fn().mockResolvedValue({
      bundleId: 'bundle-id',
      receipts: [{ transactionHash: '0xfallback' }],
    });

    await expect(executeWithCallsFallback({ call, executePrimary, sendCalls }))
      .resolves.toBe('0xfallback');
    expect(executePrimary).toHaveBeenCalledOnce();
    expect(sendCalls).toHaveBeenCalledOnce();
    expect(sendCalls).toHaveBeenCalledWith(call, expect.any(Error));
  });

  it('preserves an unrelated primary error', async () => {
    const primaryError = new Error('User rejected the request');
    const sendCalls = vi.fn();

    await expect(executeWithCallsFallback({
      call,
      executePrimary: vi.fn().mockRejectedValue(primaryError),
      sendCalls,
    })).rejects.toBe(primaryError);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it('preserves a failed bundle error without retrying', async () => {
    const bundleError = new Error('sendCalls bundle failed');
    const sendCalls = vi.fn().mockRejectedValue(bundleError);

    await expect(executeWithCallsFallback({
      call,
      executePrimary: vi.fn().mockRejectedValue(
        new Error('Cannot convert eip155:1 to a BigInt'),
      ),
      sendCalls,
    })).rejects.toBe(bundleError);
    expect(sendCalls).toHaveBeenCalledOnce();
  });
});
