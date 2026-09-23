import type { components, paths } from './schema.js';

export type LiquidEdition = components['schemas']['LiquidEdition'];
export type LiquidEditionMediaItem = NonNullable<NonNullable<LiquidEdition['media']>['image']>;
export type LiquidEditionListQuery = NonNullable<paths['/v1/liquid-editions']['get']['parameters']['query']>;
