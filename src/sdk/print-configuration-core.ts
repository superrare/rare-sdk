import { z } from 'zod';

const productId = z.string().min(1).regex(/^\S+$/);
// The server owns catalog availability; the SDK validates request shape only.
const printQuoteSchema = z.object({
  specificationId: productId,
  copies: z.number().int().min(1).max(1000).optional(),
  destinationCountryCode: z.string().regex(/^[A-Z]{2}$/),
  shippingMethod: z.literal('Standard').optional(),
}).strict();
export const validatePrintQuote = (input: unknown) => printQuoteSchema.safeParse(input);
