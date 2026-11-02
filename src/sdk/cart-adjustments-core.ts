import { z } from 'zod';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
const address = z.custom<Address>((value) => typeof value === 'string' && isAddress(value)).transform(value => getAddress(value));
const bytes32 = z.custom<Hex>((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value));
const identifier = z.string().regex(/^[1-9][0-9]*$/);
const chainId = z.number().int().positive().safe();
const uint256 = z.bigint().nonnegative().max((1n << 256n) - 1n);
const phase = z.enum(['LISTING_CONFIGURATION', 'CHECKOUT']);
const calculation = z.discriminatedUnion('type', [
 z.object({ type: z.literal('PERCENTAGE'), basisPoints: z.number().int().min(0).max(10000), currencyMode: z.literal('COMPONENT_CURRENCY') }).strict(),
 z.object({ type: z.enum(['FIXED', 'PER_UNIT']), amount: uint256.refine(value => value > 0n, 'Charge amount must be positive'), currencyMode: z.literal('COMPONENT_CURRENCY') }).strict(),
]);
const scope = z.object({
 chainIds: z.array(chainId).optional(), sellerAddresses: z.array(address).optional(), skus: z.array(bytes32).optional(),
 nfts: z.array(z.object({ chainId, contract: address, tokenId: uint256 }).strict()).min(1).max(1000).optional(),
 collections: z.array(z.object({ chainId, contract: address }).strict()).min(1).max(1000).optional(),
 productIds: z.array(identifier).optional(), fulfillmentKinds: z.array(z.number().int().min(0).max(5)).optional(),
 saleTypes: z.array(z.enum(['PRIMARY_SALE', 'SECONDARY_SALE'])).optional(), settlementCurrencies: z.array(address).optional(), paymentCurrencies: z.array(address).optional(),
}).strict();
const definition = z.object({
 effect: z.literal('CHARGE'), phase, code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/), calculation,
 recipient: z.discriminatedUnion('type', [z.object({ type: z.literal('FIXED'), address }).strict(), z.object({ type: z.literal('TOKEN_CREATOR') }).strict()]),
}).strict();
const assignmentObject = z.object({
 adjustmentId: identifier, scope: scope.default({}), priority: z.number().int().min(0).max(2147483647),
 validFrom: z.string().datetime({ offset: true }).nullable().optional(), validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
const validWindow = (value: {validFrom?: string | null; validUntil?: string | null}): boolean => value.validFrom == null || value.validUntil == null || Date.parse(value.validUntil) > Date.parse(value.validFrom);
const assignment = assignmentObject.refine(validWindow, 'validUntil must follow validFrom');
const pageQuery = z.object({phase: phase.optional(), page: z.number().int().positive().safe().default(1), perPage: z.number().int().min(1).max(100).default(20)}).strict();
export type CartAdjustmentCreateParams = z.input<typeof definition>;
export type CartAdjustmentAssignmentCreateParams = z.input<typeof assignment>;
export type CartAdjustmentListParams = z.input<typeof pageQuery>;
export type CartAdjustmentAssignmentListParams = CartAdjustmentListParams & { adjustmentId?: string };
/** Internal credentials are sent only to adjustment administration endpoints. */
export type CartAdjustmentRequestOptions = { signal?: AbortSignal; internalApiKey?: string };
export type CartAdjustment = z.output<typeof definition> & {id: string; chargeSku: Hex};
export type CartAdjustmentAssignment = z.output<typeof assignment> & {id: string};
type Page<T> = {data: T[]; pagination: {page: number; perPage: number; hasNextPage: boolean}};
export type CartAdjustmentsNamespace = {
 create: (input: CartAdjustmentCreateParams, options?: CartAdjustmentRequestOptions) => Promise<CartAdjustment>;
 list: (input?: CartAdjustmentListParams, options?: CartAdjustmentRequestOptions) => Promise<Page<CartAdjustment>>;
 assignments: {
  create: (input: CartAdjustmentAssignmentCreateParams, options?: CartAdjustmentRequestOptions) => Promise<CartAdjustmentAssignment>;
  list: (input?: CartAdjustmentAssignmentListParams, options?: CartAdjustmentRequestOptions) => Promise<Page<CartAdjustmentAssignment>>;
  disable: (id: string, options?: CartAdjustmentRequestOptions) => Promise<{id: string; disabled: boolean}>;
 };
};
const serializeScope = (value: z.output<typeof scope>) => ({
 ...value, ...(value.chainIds === undefined ? {} : {chainIds: value.chainIds.map(String)}),
 ...(value.collections === undefined ? {} : {collections: value.collections.map(item => ({...item, chainId: String(item.chainId)}))}),
 ...(value.nfts === undefined ? {} : {nfts: value.nfts.map(item => ({...item, chainId: String(item.chainId), tokenId: String(item.tokenId)}))}),
});
export const planCartAdjustmentCreate = (input: unknown) => {
 const parsed = definition.safeParse(input);
 if (!parsed.success) return {ok: false as const, message: parsed.error.message};
 const value = parsed.data;
 return {ok: true as const, value: {...value, calculation: value.calculation.type === 'PERCENTAGE' ? value.calculation : {...value.calculation, amount: String(value.calculation.amount)}}};
};
export const planCartAdjustmentAssignmentCreate = (input: unknown) => {
 const parsed = assignment.safeParse(input);
 if (!parsed.success) return {ok: false as const, message: parsed.error.message};
 return {ok: true as const, value: {...parsed.data, scope: serializeScope(parsed.data.scope)}};
};
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt).pipe(uint256);
const wireCalculation = z.discriminatedUnion('type', [calculation.options[0], calculation.options[1].extend({amount: decimal.refine(value => value > 0n)})]);
const wireDefinition = definition.extend({calculation: wireCalculation, id: identifier, chargeSku: bytes32});
const wireChain = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(chainId);
const wireScope = scope.extend({chainIds: z.array(wireChain).optional(), collections: z.array(z.object({chainId: wireChain, contract: address})).optional(), nfts: z.array(z.object({chainId: wireChain, contract: address, tokenId: decimal})).optional()});
const wireAssignment = assignmentObject.extend({scope: wireScope, id: identifier}).refine(validWindow, 'validUntil must follow validFrom');
export const parseCartAdjustment = (value: unknown): CartAdjustment => wireDefinition.parse(value);
export const parseCartAdjustmentAssignment = (value: unknown): CartAdjustmentAssignment => wireAssignment.parse(value);
export const parseCartAdjustmentPage = (value: unknown) => z.object({data: z.array(wireDefinition), hasNextPage: z.boolean()}).parse(value);
export const parseCartAdjustmentAssignmentPage = (value: unknown) => z.object({data: z.array(wireAssignment), hasNextPage: z.boolean()}).parse(value);
export const planCartAdjustmentList = (value: unknown) => pageQuery.parse(value);
export const planCartAdjustmentAssignmentList = (value: unknown) => pageQuery.extend({adjustmentId: identifier.optional()}).parse(value);
export const parseCartAdjustmentId = (value: unknown): string => identifier.parse(value);
export const parseCartAdjustmentDisabled = (value: unknown) => z.object({id: identifier, disabled: z.literal(true)}).parse(value);
export const cartAdjustmentRequestHeaders = (options?: CartAdjustmentRequestOptions): Record<string,string> => {
 if (options?.internalApiKey === undefined) return {};
 if (options.internalApiKey.length === 0 || /[\r\n]/.test(options.internalApiKey)) throw new Error('Invalid internal API key');
 return {'X-Authorization': `Bearer ${options.internalApiKey}`};
};
