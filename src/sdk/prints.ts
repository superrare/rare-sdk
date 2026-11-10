import { createApiClient } from '../data-access/client.js';
import type { SearchPageResponse } from './api.js';
import { favoritePageQuery } from './favorites-core.js';
import type { RareClientConfig } from './types/client.js';
import type { PrintsNamespace, CreatePrintDrop, PrintDropCreation, PrintBatchItem, PrintBatchOptions, PrintBatchResult,
  PrintOptionConfiguration, PrintOption, PreparePrintListing, PrintListingPreparation } from './types/prints.js';
import { isPrintBatch } from './prints-batch-core.js';
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
  function create(input: CreatePrintDrop): Promise<PrintDropCreation>;
  function create(input: readonly PrintBatchItem<CreatePrintDrop>[], options?: PrintBatchOptions<PrintDropCreation>): Promise<PrintBatchResult<PrintDropCreation>[]>;
  function create(input: CreatePrintDrop | readonly PrintBatchItem<CreatePrintDrop>[], options: PrintBatchOptions<PrintDropCreation> = {}) {
    const operation = (value: CreatePrintDrop) => data(client.POST('/v1/prints/drops', { body: value }));
    if (!isPrintBatch<CreatePrintDrop>(input)) return operation(input);
    if (input.some(item => !item.input.idempotencyKey?.trim())) throw new Error('Batch print creation requires a stable idempotencyKey for every item.');
    return runPrintBatch(input, options, operation);
  }
  function configure(input: PrintOptionConfiguration): Promise<PrintOption>;
  function configure(items: readonly PrintBatchItem<PrintOptionConfiguration>[], options?: PrintBatchOptions<PrintOption>): Promise<PrintBatchResult<PrintOption>[]>;
  function configure(input: PrintOptionConfiguration | readonly PrintBatchItem<PrintOptionConfiguration>[], options: PrintBatchOptions<PrintOption> = {}) {
    const operation = (value: PrintOptionConfiguration) => data(client.PUT('/v1/prints/drops/{id}/options/standard', { params: { path: { id: value.dropId } }, body: value.input }));
    return isPrintBatch<PrintOptionConfiguration>(input) ? runPrintBatch(input, options, operation) : operation(input);
  }
  function prepare(input: PreparePrintListing): Promise<PrintListingPreparation>;
  function prepare(input: readonly PrintBatchItem<PreparePrintListing>[], options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
  function prepare(input: PreparePrintListing | readonly PrintBatchItem<PreparePrintListing>[], options: PrintBatchOptions<PrintListingPreparation> = {}) {
    const operation = (value: PreparePrintListing) => {
      const validation = validatePrintListingQuantityLimit(value);
      if (!validation.valid) return Promise.reject(new Error(validation.message));
      return data(client.POST('/v1/prints/listings/prepare', { body: value }));
    };
    return isPrintBatch<PreparePrintListing>(input) ? runPrintBatch(input, options, operation) : operation(input);
  }
  return {
    concierge: {
      createDraft: (input, options = {}) => data(client.POST('/v1/prints/concierge/drafts', { body: input, signal: options.signal })),
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
    listings: { prepare },
  };
}
