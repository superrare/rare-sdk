# Platform adjustments

Adjustment definitions and their assignments are separate resources. Only `effect: 'CHARGE'` is supported today. A zero-percent charge waives an existing fee code. Discounts and negative amounts are rejected; a future discount effect will need its own pricing, target and funding semantics.

```typescript
const options = { internalApiKey: process.env.GQL_API_KEY };
const adjustment = await rare.cart.adjustments.create({
  effect: 'CHARGE',
  phase: 'LISTING_CONFIGURATION',
  code: 'GALLERY_COMMISSION',
  calculation: { type: 'PERCENTAGE', basisPoints: 3000, currencyMode: 'COMPONENT_CURRENCY' },
  recipient: { type: 'FIXED', address: treasury },
}, options);

const assignment = await rare.cart.adjustments.assignments.create({
  adjustmentId: adjustment.id,
  priority: 100,
  scope: { skus: [nftMintSku, printSku], saleTypes: ['PRIMARY_SALE'] },
}, options);

await rare.cart.adjustments.list({ page: 1, perPage: 20 }, options);
await rare.cart.adjustments.assignments.list({ adjustmentId: adjustment.id }, options);
await rare.cart.adjustments.assignments.disable(assignment.id, options);
```

The internal key is sent only on these administration requests, using `X-Authorization: Bearer <key>`. It bypasses account-session acquisition for these requests and grants no permissions elsewhere. Omit `internalApiKey` to use the client's normal account transport; Rare API requires the canonical user ID in `CART_ADMIN_USER_IDS`. Creators do not gain permissions by owning a Product or NFT. All operations also accept `signal` in their second argument.

Creating a definition creates its stable charge SKU without activating it. Reuse that definition for multiple scoped assignments. Disabling an assignment preserves the definition and its other assignments. Definitions are immutable. For an uncertain POST result, inspect existing records before retrying; creation is not an upsert.

Highest priority wins for the same adjustment code. Equal highest priorities are rejected. Configure seller-side assignments before preparing and signing listings. Existing signatures keep their authorized terms. CHECKOUT adjustments use per-currency subtotals, not item scopes. Fixed amounts are base-unit bigint values; scope them to the appropriate settlement currency. NFT scope token IDs are bigint and chain IDs are numbers.

CLI commands use the same resource structure: `rare cart adjustments create|list` and `rare cart adjustments assignments create|list|disable`. Writes require `--yes`; create commands read `--input file.json`. Use `--api-key-env GQL_API_KEY` for internal access, or the normal administrator account login. JSON input files use decimal strings for fixed amounts and token IDs. `--json` enables machine-readable results.
