import { z } from 'zod';

const productId = z.string().min(1).regex(/^\S+$/);
// The server owns catalog availability; the SDK validates request shape only.
const printQuoteSchema = z.object({
  specificationId: productId,
  copies: z.number().int().min(1).max(1000).optional(),
  destinationCountryCode: z.string().regex(/^[A-Z]{2}$/),
  shippingMethod: z.literal('Standard').optional(),
}).strict();
const printFormatsSchema = z.object({
  displayPriceUsdCents: z.string().regex(/^(0|[1-9][0-9]*)$/).max(18),
  specificationIds: z.array(productId).min(1).max(100).refine(values => new Set(values).size === values.length, 'Select each print product once.'),
}).strict();
export const validatePrintQuote = (input: unknown) => printQuoteSchema.safeParse(input);
export const validatePrintFormats = (input: unknown) => printFormatsSchema.safeParse(input);
