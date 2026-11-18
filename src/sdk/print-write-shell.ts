import type { Middleware } from 'openapi-fetch';
import { RareApiError } from '../data-access/errors.js';
import { RareAuthError } from './account-auth-core.js';
import type { RareAuthRequestOptions } from './types/account.js';

/** Rare API may have saved the request. Resume with the same client and account. */
export class PrintRequestUncertainError<Result = unknown> extends Error {
  readonly #resume: (options?: RareAuthRequestOptions) => Promise<Result>;

  constructor(cause: unknown, resume: (options?: RareAuthRequestOptions) => Promise<Result>) {
    super('Rare API could not confirm the print request. Resume this request to check its outcome.', { cause });
    this.name = 'PrintRequestUncertainError';
    this.#resume = resume;
  }

  /** Retry the original request using its saved identifiers. */
  resume(options?: RareAuthRequestOptions): Promise<Result> {
    return this.#resume(options);
  }
}

class PrintTransportError extends Error {}

const middleware: Middleware[] = [{
  onError: ({ error }) => error instanceof RareApiError || error instanceof RareAuthError
    ? error
    : new PrintTransportError('The print request did not receive a response.', { cause: error }),
}];

function mayHaveWritten(error: unknown): boolean {
  if (error instanceof RareApiError) {
    return error.status >= 500 || error.status === 408 || error.code === 'idempotency_in_progress'
      || error.code === 'transport_error' || error.code === 'cancelled';
  }
  return error instanceof PrintTransportError || error instanceof SyntaxError
    || error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export async function runPrintWrite<Result>(
  send: (options: { signal: AbortSignal; middleware: Middleware[] }) => Promise<{ data?: { data: Result } }>,
  options: RareAuthRequestOptions = {},
  previousOutcomeUncertain = false,
): Promise<Result> {
  const { signal } = options;
  signal?.throwIfAborted();
  const resume = (next?: RareAuthRequestOptions): Promise<Result> => runPrintWrite(send, next, true);

  const attempt = async (outcomeUncertain: boolean, canRetry: boolean): Promise<Result> => {
    try {
      const timeout = AbortSignal.timeout(30_000);
      const response = await send({ signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]), middleware });
      const result = response.data?.data;
      if (result === undefined || result === null) throw new PrintTransportError('Rare API returned no print result.');
      return result;
    } catch (error) {
      const uncertain = mayHaveWritten(error);
      if (!uncertain && !outcomeUncertain) throw error;
      if (!uncertain || signal?.aborted || !canRetry) throw new PrintRequestUncertainError(error, resume);
      return attempt(true, false);
    }
  };
  return attempt(previousOutcomeUncertain, true);
}
