import { generateCartListingSalt } from './cart-listing-shell.js';
import type { PreparePrintListing, PrintDropInput, PrintListingInput } from './types/prints.js';

/** Resolve a draft request once and retain it if the operation may be retried. */
export function createPrintDropRequest<T extends PrintDropInput>(input: T): T & { idempotencyKey: string } {
  return { ...input, idempotencyKey: input.idempotencyKey ?? globalThis.crypto.randomUUID() };
}

/** Resolve listing terms once and retain them if preparation may be retried. */
export function createPrintListingRequest(input: PrintListingInput): PreparePrintListing {
  return withListingSalt(input);
}

function withListingSalt<T extends { listingSalt?: string }>(input: T): T & { listingSalt: string } {
  return { ...input, listingSalt: input.listingSalt ?? generateCartListingSalt() };
}
