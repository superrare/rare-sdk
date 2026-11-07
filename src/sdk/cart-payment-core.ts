import { isAddressEqual, type Address } from 'viem';
import { z } from 'zod';
import type { CartPaymentRequest, CartDeliveryCheckout } from './types/cart-api.js';
import { validateCartCheckoutIntent } from './cart-core.js';

const emailSchema = z.email().max(320);
const identifierSchema = z.uuid();
const paymentEmail = (value: unknown) => emailSchema.parse(value);
const paymentIdentity = (value: unknown) => identifierSchema.parse(value);

/** Payment selection reuses an existing quote; provider session creation remains server-owned. */
export function planCartPayment(input: CartPaymentRequest, scope: { chainId: string | number; cartAddress: Address }): {
  idempotencyKey: string;
  preparationReference: string;
  email: string;
  delivery?: CartDeliveryCheckout;
} {
  const preparation = input.preparation;
  if (input.method !== 'card') throw new Error('Unsupported Cart payment method.');
  if (preparation.chainId !== BigInt(scope.chainId) || !isAddressEqual(preparation.cartAddress, scope.cartAddress)) throw new Error('Cart checkout preparation belongs to another deployment.');
  const email = paymentEmail(input.email);
  const preparationReference = paymentIdentity(preparation.preparationReference);
  const idempotencyKey = paymentIdentity(preparation.idempotencyKey ?? preparationReference);
  const intent = preparation.intent;
  const validation = validateCartCheckoutIntent(intent);
  if (!validation.isValid) throw new Error('Cart checkout intent is invalid.');
  if (intent.delivery === undefined) return { idempotencyKey, preparationReference, email };
  return { idempotencyKey, preparationReference, email, delivery: { ...intent, delivery: intent.delivery, idempotencyKey } };
}
