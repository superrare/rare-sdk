import { z } from 'zod';

const orderIdSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const accountIdSchema = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= 9223372036854775807n);
export const messagingPrintOrderReferenceSchema = z.object({
  id: orderIdSchema,
  buyerUserId: accountIdSchema,
  sellerUserId: accountIdSchema,
  lineIndexes: z.array(z.number().int().nonnegative()).min(1).max(64),
});
const destinationSchema = messagingPrintOrderReferenceSchema.extend({
  conversationId: z.uuid(), messageId: z.uuid(), sequence: z.string().regex(/^[1-9][0-9]*$/),
});
const productSchema = z.object({
  id: z.string(), paper: z.string(), size: z.string(), widthInches: z.number().positive(), heightInches: z.number().positive(),
  sizeCategory: z.enum(['small', 'medium', 'large', 'extraLarge']), format: z.enum(['rectangular', 'square']),
});
const cardSchema = z.object({
  chainId: z.number().int().positive(),
  order: z.object({
    id: z.string(), status: z.literal('CONFIRMED'), paymentCurrency: z.string().nullable(), paymentAmount: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
    items: z.array(z.object({
      lineIndex: z.number().int().nonnegative(), listingDigest: z.string(), sku: z.string(), quantity: z.string(),
      fulfillmentStatus: z.enum(['PENDING', 'SUBMITTED', 'IN_PRODUCTION', 'PARTIALLY_SHIPPED', 'SHIPPED', 'FULFILLED', 'FAILED', 'CANCELLED']),
      title: z.string().nullable(), images: z.array(z.string()), printDropId: z.uuid().nullable(), printProduct: productSchema.optional(),
    })).optional(),
    fulfillments: z.tuple([]),
  }),
});
export type MessagingPrintOrderReference = z.infer<typeof messagingPrintOrderReferenceSchema>;
export type MessagingPrintOrderDestination = z.infer<typeof destinationSchema>;
export type MessagingPrintOrderCard = z.infer<typeof cardSchema>;
export const messagingOrderId = (value: unknown) => orderIdSchema.parse(value);
export const parseMessagingOrderDestinations = (value: unknown) => z.array(destinationSchema).parse(value);
export const parseMessagingOrderCard = (value: unknown) => cardSchema.parse(value);
export const parseMessagingPrintOrder = (value: unknown) => messagingPrintOrderReferenceSchema.parse(value);
