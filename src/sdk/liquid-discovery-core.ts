import type { Address } from 'viem';
import { chainIds, type SupportedChain } from '../contracts/addresses.js';
import type { LiquidEditionListQuery } from '../data-access/liquid-editions.js';

/** Uses query for full-text search, matching NFT discovery. */
export type LiquidEditionSearchParams = Omit<LiquidEditionListQuery, 'q' | 'isApprovedCreator' | 'hasCurrentPrice'> & {
  query?: string;
  isApprovedCreator?: boolean;
  hasCurrentPrice?: boolean;
};

export function buildLiquidEditionSearchQuery(params: LiquidEditionSearchParams = {}): LiquidEditionListQuery {
  const { query, isApprovedCreator, hasCurrentPrice, ...filters } = params;
  return {
    ...filters,
    q: query,
    isApprovedCreator: isApprovedCreator === undefined ? undefined : isApprovedCreator ? 'true' : 'false',
    hasCurrentPrice: hasCurrentPrice === undefined ? undefined : hasCurrentPrice ? 'true' : 'false',
  };
}

export function buildLiquidEditionId(chain: SupportedChain, params: { contract: Address }): string {
  if ('chain' in params || 'chainId' in params) {
    throw new Error(`rare.liquidEdition.get uses the RareClient chain (${chain}). Create another RareClient with a different publicClient to use another chain.`);
  }
  return `${chainIds[chain]}-${params.contract}`;
}
