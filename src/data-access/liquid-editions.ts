import type { components, paths as GeneratedPaths } from './schema.js';

// rare-api PR #2041: pending deployment and v3 index activation. Keep this
// contract separate until the deployed OpenAPI schema includes these endpoints.
export type LiquidEditionMediaItem = {
  uri: string;
  mimeType: string;
  size: number | null;
  dimensions: { width: number; height: number } | null;
};

export type LiquidEdition = {
  id: string;
  chainId: string;
  contractAddress: string;
  baseToken: string;
  name: string | null;
  collectionName: string | null;
  description: string | null;
  createdAt: string;
  creatorAddress: string;
  isApprovedCreator: boolean;
  creator: {
    address: string;
    username: string | null;
    fullName: string | null;
    avatar: string | null;
  };
  mediaType: 'IMAGE' | 'HTML' | 'THREE_D' | 'VIDEO' | null;
  tags: string[];
  media: {
    image: LiquidEditionMediaItem;
    html: LiquidEditionMediaItem | null;
    threeD: LiquidEditionMediaItem | null;
    video: LiquidEditionMediaItem | null;
  } | null;
  currentPrice: {
    cryptoAmount: string;
    usdAmount: number;
    currency: { address: string; decimals: number; symbol: string };
  } | null;
  stats: { decimals: number; totalSupply: string; holderCount: number };
};

export type LiquidEditionListQuery = {
  /** Full-text search, at most 500 characters. */
  q?: string;
  /** Omit to search all supported chains. */
  chainId?: number;
  contractAddress?: string;
  creatorAddress?: string;
  /** Positive indexed collector balance, excluding system and self-holdings. */
  holderAddress?: string;
  isApprovedCreator?: boolean;
  hasCurrentPrice?: boolean;
  currentPriceCurrencyAddress?: string;
  /** Inclusive nonnegative USD bound. Incompatible with hasCurrentPrice=false. */
  priceMin?: number;
  /** Inclusive nonnegative USD bound. Incompatible with hasCurrentPrice=false. */
  priceMax?: number;
  mediaType?: NonNullable<LiquidEdition['mediaType']>;
  /** Match any supplied tag; at most 50 tags. */
  tags?: string[];
  /** Defaults to newest. Price sorting requires a current price. */
  sortBy?: 'newest' | 'oldest' | 'priceAsc' | 'priceDesc' | 'holderCountAsc' | 'holderCountDesc';
  /** Defaults to 1. */
  page?: number;
  /** Defaults to 20; maximum 100. */
  perPage?: number;
};

type JsonResponse<T> = {
  headers: { [name: string]: unknown };
  content: { 'application/json': T };
};

type LiquidEditionPaths = {
  '/v1/liquid-editions': {
    get: {
      parameters: { query?: LiquidEditionListQuery };
      responses: {
        200: JsonResponse<{ data: LiquidEdition[]; pagination: components['schemas']['Pagination'] }>;
      };
    };
  };
  '/v1/liquid-editions/{id}': {
    get: {
      parameters: { path: { id: string } };
      responses: { 200: JsonResponse<{ data: LiquidEdition }> };
    };
  };
};

export type ApiPaths = Omit<GeneratedPaths, keyof LiquidEditionPaths> & LiquidEditionPaths;
