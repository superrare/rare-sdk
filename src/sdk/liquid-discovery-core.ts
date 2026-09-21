import type { Address } from 'viem';
import { chainIds, type SupportedChain } from '../contracts/addresses.js';
import type { LiquidEditionListQuery } from '../data-access/liquid-editions.js';

/** Uses query for full-text search, matching NFT discovery. */
export type LiquidEditionSearchParams = Omit<LiquidEditionListQuery, 'q'> & { query?: string };

export function buildLiquidEditionSearchQuery(params: LiquidEditionSearchParams = {}): LiquidEditionListQuery {
  const { query, ...filters } = params;
  return { ...filters, q: query };
}

export function buildLiquidEditionId(chain: SupportedChain, params: { contract: Address }): string {
  if ('chain' in params || 'chainId' in params) {
    throw new Error(`rare.liquidEdition.get uses the RareClient chain (${chain}). Create another RareClient with a different publicClient to use another chain.`);
  }
  return `${chainIds[chain]}-${params.contract}`;
}
