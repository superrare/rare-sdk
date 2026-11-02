import type { CartAdjustmentsNamespace, CartAdjustmentRequestOptions } from './cart-adjustments-core.js';
import { planCartAdjustmentCreate, planCartAdjustmentAssignmentCreate, parseCartAdjustment, parseCartAdjustmentAssignment, parseCartAdjustmentPage, parseCartAdjustmentAssignmentPage, planCartAdjustmentList, planCartAdjustmentAssignmentList, parseCartAdjustmentId, parseCartAdjustmentDisabled, cartAdjustmentRequestHeaders } from './cart-adjustments-core.js';
type Transport = {
 GET: (path: string, options?: unknown) => Promise<{data?: unknown}>;
 POST: (path: string, options?: unknown) => Promise<{data?: unknown}>;
 DELETE: (path: string, options?: unknown) => Promise<{data?: unknown}>;
};
const wrapped = (input: unknown): unknown => {
 if (input === null || typeof input !== 'object' || !('data' in input)) throw new Error('Rare API did not return the adjustment operation result.');
 return input.data;
};
export const createCartAdjustmentsNamespace = (authenticated: Transport, publicTransport: Transport): CartAdjustmentsNamespace => {
 const transport = (options?: CartAdjustmentRequestOptions): Transport => options?.internalApiKey === undefined ? authenticated : publicTransport;
 const requestOptions = (options?: CartAdjustmentRequestOptions) => ({signal: options?.signal, headers: cartAdjustmentRequestHeaders(options)});
 return {
  async create(input, options) {
   const plan = planCartAdjustmentCreate(input); if (!plan.ok) throw new Error(plan.message);
   return parseCartAdjustment(wrapped((await transport(options).POST('/v1/cart/adjustments', {...requestOptions(options), body: plan.value})).data));
  },
  async list(input = {}, options) {
   const query = planCartAdjustmentList(input);
   const page = parseCartAdjustmentPage((await transport(options).GET('/v1/cart/adjustments', {...requestOptions(options), params: {query}})).data);
   return {data: page.data, pagination: {page: query.page, perPage: query.perPage, hasNextPage: page.hasNextPage}};
  },
  assignments: {
   async create(input, options) {
    const plan = planCartAdjustmentAssignmentCreate(input); if (!plan.ok) throw new Error(plan.message);
    return parseCartAdjustmentAssignment(wrapped((await transport(options).POST('/v1/cart/adjustments/assignments', {...requestOptions(options), body: plan.value})).data));
   },
   async list(input = {}, options) {
    const query = planCartAdjustmentAssignmentList(input);
    const page = parseCartAdjustmentAssignmentPage((await transport(options).GET('/v1/cart/adjustments/assignments', {...requestOptions(options), params: {query}})).data);
    return {data: page.data, pagination: {page: query.page, perPage: query.perPage, hasNextPage: page.hasNextPage}};
   },
   async disable(input, options) {
    const id = parseCartAdjustmentId(input);
    return parseCartAdjustmentDisabled(wrapped((await transport(options).DELETE(`/v1/cart/adjustments/assignments/${id}`, requestOptions(options))).data));
   },
  },
 };
};
