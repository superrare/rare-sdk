import { createApiClient } from '../data-access/client.js';
import type { SearchPageResponse } from './api.js';
import { favoritePageQuery } from './favorites-core.js';
import type { RareClientConfig } from './types/client.js';
import type { PrintsNamespace, PrintDropInput, PrintListingInput, CreatePrintDrop, PrintDropCreation, PrintBatchInput, PrintSetupOptions, PrintBatchOptions, PrintBatchResult,
  PrintOptionConfiguration, PrintOption, PreparePrintListing, PrintListingPreparation } from './types/prints.js';
import { createConciergePrintRequest, createPrintDropRequest, createPrintListingRequest, retainPrintIdentifier } from './print-request-shell.js';
import { runPrintWrite } from './print-write-shell.js';
import { isPrintBatch, printBatchInputDigest, printBatchItems } from './prints-batch-core.js';
import { runPrintBatch } from './prints-batch-shell.js';
import { validatePrintListingQuantityLimit } from './prints-core.js';
import { validatePrintQuote, validatePrintFileInput, validatePrintMockupId } from './print-configuration-core.js';

export function createPrintsNamespace(config: RareClientConfig, authenticatedFetch?: typeof globalThis.fetch): PrintsNamespace {
  const publicClient = createApiClient(config.apiBaseUrl, config.apiFetch);
  const client = createApiClient(config.apiBaseUrl, authenticatedFetch ?? config.apiFetch);
  const page = async <T>(request: Promise<{ data?: SearchPageResponse<T> }>): Promise<SearchPageResponse<T>> => {
    const result = await request;
    if (result.data === undefined) throw new Error('Rare API did not return print data.');
    return result.data;
  };
  const data = async <T>(request: Promise<{ data?: { data: T } }>): Promise<T> => {
    const response = await request;
    if (response.data === undefined) throw new Error('Rare API did not return print data.');
    return response.data.data;
  };
  function create(input: PrintDropInput, options?: PrintSetupOptions): Promise<PrintDropCreation>;
  function create(input: PrintBatchInput<PrintDropInput>, options?: PrintBatchOptions<PrintDropCreation>): Promise<PrintBatchResult<PrintDropCreation>[]>;
  function create(input: PrintDropInput | PrintBatchInput<PrintDropInput>, options: PrintBatchOptions<PrintDropCreation> = {}) {
    const operation = async (input: PrintDropInput, key = '0') => {
      const value = structuredClone(input);
      const idempotencyKey = value.idempotencyKey ?? await retainPrintIdentifier(
        options.recovery, `draft:${printBatchInputDigest([key, value])}`, () => createPrintDropRequest(value).idempotencyKey);
      const body: CreatePrintDrop = { ...value, idempotencyKey };
      return runPrintWrite(request => client.POST('/v1/prints/drops', { ...request, body }));
    };
    return isPrintBatch<PrintDropInput>(input) ? runPrintBatch(printBatchItems(input), options, operation) : operation(input);
  }
  function configure(input: PrintOptionConfiguration, options?: PrintSetupOptions): Promise<PrintOption>;
  function configure(items: PrintBatchInput<PrintOptionConfiguration>, options?: PrintBatchOptions<PrintOption>): Promise<PrintBatchResult<PrintOption>[]>;
  function configure(input: PrintOptionConfiguration | PrintBatchInput<PrintOptionConfiguration>, options: PrintBatchOptions<PrintOption> = {}) {
    const operation = (value: PrintOptionConfiguration) => data(client.PUT('/v1/prints/drops/{id}/options/standard', { params: { path: { id: value.dropId } }, body: value.input }));
    return isPrintBatch<PrintOptionConfiguration>(input) ? runPrintBatch(printBatchItems(input), options, operation) : operation(input);
  }
  function prepare(input: PrintListingInput, options?: PrintSetupOptions): Promise<PrintListingPreparation>;
  function prepare(input: PrintBatchInput<PrintListingInput>, options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
  function prepare(input: PrintListingInput | PrintBatchInput<PrintListingInput>, options: PrintBatchOptions<PrintListingPreparation> = {}) {
    const operation = async (input: PrintListingInput, key = '0') => {
      const value = structuredClone(input);
      const validation = validatePrintListingQuantityLimit(value);
      if (!validation.valid) throw new Error(validation.message);
      const listingSalt = value.listingSalt ?? await retainPrintIdentifier(
        options.recovery, `prepare:${printBatchInputDigest([key, value])}`, () => createPrintListingRequest(value).listingSalt);
      const body: PreparePrintListing = { ...value, listingSalt };
      return runPrintWrite(request => client.POST('/v1/prints/listings/prepare', { ...request, body }));
    };
    return isPrintBatch<PrintListingInput>(input) ? runPrintBatch(printBatchItems(input), options, operation) : operation(input);
  }
  return {
    concierge: {
      createDraft: (input, options) => {
        const body = structuredClone(createConciergePrintRequest(input));
        return runPrintWrite(request => client.POST('/v1/prints/concierge/drafts', { ...request, body }), options);
      },
    },
    async quote(input, options = {}) {
      const validation = validatePrintQuote(input);
      if (!validation.success) throw new Error('Provide a print product ID, positive copy count and two-letter destination country code.');
      return data(client.POST('/v1/prints/estimates', { body: validation.data, signal: options.signal }));
    },
    files: {
      async validate(input, options = {}) {
        const validation = validatePrintFileInput(input);
        if (!validation.success) throw new Error('Provide a private production upload key and print specification ID.');
        return data(client.POST('/v1/prints/files/validate', { body: validation.data, signal: options.signal }));
      },
    },
    mockups: {
      async create(input, options = {}) {
        const validation = validatePrintFileInput(input);
        if (!validation.success) throw new Error('Provide a private production upload key and print specification ID.');
        return data(client.POST('/v1/prints/mockups', { body: validation.data, signal: options.signal }));
      },
      async get(id, options = {}) {
        const validation = validatePrintMockupId(id);
        if (!validation.success) throw new Error('Provide a valid Rare print mockup ID.');
        return data(client.GET('/v1/prints/mockups/{id}', { params: { path: { id: validation.data } }, signal: options.signal }));
      },
    },
    products: {
      list: (options = {}) => data(publicClient.GET('/v1/prints/products', { signal: options.signal })),
      get: (id, options = {}) => data(publicClient.GET('/v1/prints/products/{id}', { params: { path: { id } }, signal: options.signal })),
    },
    drops: {
      create,
      update: (id, input) => data(client.PATCH('/v1/prints/drops/{id}', { params: { path: { id } }, body: input })),
      listMine: (params = {}, options = {}) => page(client.GET('/v1/prints/drops/mine', { params: { query: { ...favoritePageQuery(params), ...(params.productId === undefined ? {} : { productId: params.productId }) } }, signal: options.signal })),
      getMine: id => data(client.GET('/v1/prints/drops/mine/{id}', { params: { path: { id } } })),
      get: id => data(publicClient.GET('/v1/prints/drops/{id}', { params: { path: { id } } })),
      archive: id => data(client.POST('/v1/prints/drops/{id}/archive', { params: { path: { id } } })),
      activity: (id, options = {}) => data(publicClient.GET('/v1/prints/drops/{id}/activity', { params: { path: { id }, query: favoritePageQuery(options) } })),
    },
    releases: { list: input => data(publicClient.GET('/v1/prints/releases', { params: { query: input } })) },
    options: { configure },
    listings: {
      prepare,
      getPreparation: (id, options = {}) => data(client.GET('/v1/prints/listings/preparations/{id}', {
        params: { path: { id } }, signal: options.signal,
      })),
    },
  };
}
