import type { Hash, TransactionReceipt, WalletClient } from 'viem';
import type {
  CurrencyInfo,
  CurrencyInput,
  CurrencyName,
  CustomCurrencyInfo,
  ResolvedCurrency,
} from '../../contracts/addresses.js';

export type IntegerInput = bigint | number | string;
export type AmountInput = bigint | number | string;
export type TimestampInput = IntegerInput | Date;
export type WalletAccount = NonNullable<WalletClient['account']>;
export type {
  CurrencyInfo,
  CurrencyInput,
  CurrencyName,
  CustomCurrencyInfo,
  ResolvedCurrency,
};
export type ResolvedCurrencyWithDecimals =
  | CurrencyInfo
  | (Omit<CustomCurrencyInfo, 'decimals'> & { decimals: number });

export type TransactionResult = {
  txHash: Hash;
  receipt: TransactionReceipt;
}

export type WaitForReceiptOption = {
  waitForReceipt?: boolean;
}

export type ApprovalTxHashField = 'approvalTxHash' | 'approvalTxHashes' | 'approvalResetTxHash';

export type SubmittedTransactionFields<Result> = {
  txHash: Hash;
} & Pick<Result, Extract<keyof Result, ApprovalTxHashField>>;

export type SubmittedTransaction<Result> = SubmittedTransactionFields<Result> & {
  wait: () => Promise<Result>;
}

// The no-flag signature comes first so it wins resolution (also for any-typed params), and repeats last for ReturnType<> and Parameters<>.
export type TransactionMethod<Params, Result> = {
  (params: Params & { waitForReceipt?: undefined }): Promise<Result>;
  (params: Params & { waitForReceipt: false }): Promise<SubmittedTransaction<Result>>;
  (params: Params & { waitForReceipt: true }): Promise<Result>;
  (params: Params & { waitForReceipt?: boolean | undefined }): Promise<Result | SubmittedTransaction<Result>>;
  (params: Params & { waitForReceipt?: undefined }): Promise<Result>;
}
