import type { CartCheckoutIntent } from './types/cart-api.js';
import type { CartValidationIssue } from './types/cart.js';

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Check caller intent before requesting a quote. The server verifies fulfillment kinds and Product mappings. */
export function validateCartPrintSelections(intent: CartCheckoutIntent): CartValidationIssue[] {
  const delivery = intent.delivery;
  if (delivery === undefined) return [];
  const options = delivery.optionSelections;
  const validOptions = options === undefined || (options.length > 0 && options.length <= 64
    && options.every(option => isUuid(option.preparationId) && isUuid(option.optionId))
    && new Set(options.map(option => option.preparationId.toLowerCase())).size === options.length);
  const optionIssues = validOptions ? [] : [{ code: 'invalid_print_options', field: 'delivery.optionSelections', message: 'Select one valid format per print preparation.' }];
  const selections = delivery.mintSelections;
  if (selections === undefined) return optionIssues;
  const validSelections = selections.length > 0 && selections.length <= 64
    && new Set(selections.map(selection => selection.preparationId.toLowerCase())).size === selections.length
    && selections.every(selection => isUuid(selection.preparationId) && /^0x[0-9a-fA-F]{64}$/.test(selection.listingDigest)
      && selection.unitIndexes.length > 0 && selection.unitIndexes.length <= 1000
      && selection.unitIndexes.every(index => Number.isInteger(index) && index >= 0 && index < 1000));
  if (!validSelections) return [...optionIssues, { code: 'invalid_mint_selection', field: 'delivery.mintSelections', message: 'Provide distinct print preparations and nonnegative mint unit indexes.' }];
  const selectedUnits = selections.flatMap(selection => selection.unitIndexes.map(index => `${selection.listingDigest.toLowerCase()}:${index}`));
  const duplicateIssues = new Set(selectedUnits).size === selectedUnits.length ? [] : [{
    code: 'duplicate_mint_unit', field: 'delivery.mintSelections', message: 'A minted unit can accompany only one physical copy in this checkout.',
  }];
  const sourceIssues = selections.flatMap((selection, index) => {
    const sources = intent.items.filter(item => item.kind === 'listing' && item.listingDigest.toLowerCase() === selection.listingDigest.toLowerCase());
    const source = sources[0];
    return sources.length === 1 && source?.kind === 'listing' && selection.unitIndexes.every(unit => BigInt(unit) < source.quantity)
      ? [] : [{ code: 'invalid_mint_source', field: `delivery.mintSelections[${index}]`, message: 'The paired mint listing and every selected unit must exist in this checkout.' }];
  });
  return [...optionIssues, ...duplicateIssues, ...sourceIssues];
}
