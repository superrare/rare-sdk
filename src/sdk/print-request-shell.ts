import { generateCartListingSalt } from './cart-listing-shell.js';
import type { ConciergePrintInput, CreateConciergePrint, PreparePrintListing, PrintDropInput, PrintListingInput } from './types/prints.js';

/** Resolve a draft request once and retain it if the operation may be retried. */
export function createPrintDropRequest<T extends PrintDropInput>(input: T): T & { idempotencyKey: string } {
  return { ...input, idempotencyKey: input.idempotencyKey ?? globalThis.crypto.randomUUID() };
}

/** Resolve listing terms once and retain them if preparation may be retried. */
export function createPrintListingRequest(input: PrintListingInput): PreparePrintListing {
  return withListingSalt(input);
}

/** Resolve a concierge request before sending so the same request can be replayed. */
export function createConciergePrintRequest({ drop, listing, ...terms }: ConciergePrintInput): CreateConciergePrint {
  return {
    ...terms,
    drop: createPrintDropRequest(drop),
    ...(listing === undefined ? {} : { listing: withListingSalt(listing) }),
  };
}

function withListingSalt<T extends { listingSalt?: string }>(input: T): T & { listingSalt: string } {
  return { ...input, listingSalt: input.listingSalt ?? generateCartListingSalt() };
}
