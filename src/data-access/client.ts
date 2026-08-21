import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';
import { RareApiError } from './errors.js';
import { resolveRareApiBaseUrl } from './base-url.js';

const errorMiddleware: Middleware = {
  async onResponse({ response, request }) {
    if (response.ok) return;

    const url = new URL(request.url);
    const path = url.pathname;
    const error = await readError(response);
    const fallback = response.statusText.length > 0 ? response.statusText : 'Request failed';

    throw new RareApiError(
      error?.message ?? fallback,
      response.status,
      path,
      error?.details,
    );
  },
};

export function createApiClient(
  baseUrl?: string,
  fetch?: typeof globalThis.fetch,
): ReturnType<typeof createClient<paths>> {
  const client = createClient<paths>({
    baseUrl: resolveRareApiBaseUrl(baseUrl),
    ...(fetch === undefined ? {} : { fetch }),
  });

  client.use(errorMiddleware);

  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function readError(response: Response): Promise<{ message: string; details?: unknown } | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (!isErrorBody(body)) return undefined;
    if (typeof body.error === 'string') return { message: body.error };
    if (isStructuredError(body.error)) return { message: body.error.message, details: body.error };
    return undefined;
  } catch {
    return undefined;
  }
}

function isErrorBody(value: unknown): value is { error: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error !== undefined
  );
}

function isStructuredError(value: unknown): value is { message: string } {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}
