import type {
  SubmittedTransaction,
  SubmittedTransactionFields,
  TransactionMethod,
  WaitForReceiptOption,
} from './types/common.js';

export type PendingTransaction<Result> = {
  submitted: SubmittedTransactionFields<Result>;
  settle: () => Promise<Result>;
}

export async function resolvePendingTransaction<Result>(
  pending: PendingTransaction<Result>,
  waitForReceipt: boolean | undefined,
): Promise<Result | SubmittedTransaction<Result>> {
  if (waitForReceipt === false) {
    return { ...pending.submitted, wait: pending.settle };
  }

  return pending.settle();
}

export function defineTransactionMethod<Params, Result>(
  submit: (params: Params & WaitForReceiptOption) => Promise<PendingTransaction<Result>>,
): TransactionMethod<Params, Result>;
// TypeScript cannot relate one implementation to an overload set whose return type follows the flag.
export function defineTransactionMethod<Params, Result>(
  submit: (params: Params & WaitForReceiptOption) => Promise<PendingTransaction<Result>>,
): (params: Params & WaitForReceiptOption) => Promise<Result | SubmittedTransaction<Result>> {
  return async (params) => {
    const paramsAtCall = { ...params };
    return resolvePendingTransaction(await submit(paramsAtCall), paramsAtCall.waitForReceipt);
  };
}
