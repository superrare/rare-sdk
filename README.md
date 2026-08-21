# @rareprotocol/rare-sdk

SuperRare / Rare Protocol TypeScript SDK: marketplace listings, offers,
auctions, minting, releases, bridging, liquid editions, and a typed client for
the public Rare API.

Extracted from [`@rareprotocol/rare-cli`](https://github.com/superrare/rare-cli)
so applications can consume the SDK without the CLI (and without its
CLI-only dependencies).

## Install

```bash
npm install @rareprotocol/rare-sdk viem
```

The SDK supports Node.js 22 and newer. It publishes ESM and CommonJS builds;
browser applications may use the ESM entry points when their bundler provides
the wallet, RPC, and file capabilities required by the methods they call.

## Client configuration

`createRareClient` accepts a viem public client for reads and simulation. Add a
wallet client for write operations. Use `apiBaseUrl` for non-production Rare
API access and `uniswapApiKey` only for hosted Uniswap routing.

## Usage

```ts
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { createRareClient } from '@rareprotocol/rare-sdk';

const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const rare = createRareClient({ publicClient });

const status = await rare.listing.status({
  contract: '0x…',
  tokenId: '1',
  target: '0x0000000000000000000000000000000000000000',
});
```

Features are grouped by intent under `rare.listing`, `rare.offer`,
`rare.auction`, `rare.collection`, `rare.liquidEdition`, `rare.bridge`,
`rare.swap`, `rare.search`, `rare.nft`, `rare.token`, and `rare.utils`.
Batch listings and release configuration are available through
`rare.listing.batch` and `rare.listing.release`; ERC-1155 collection,
listing, and offer behavior is nested under its corresponding intent namespace.

Cart commerce is grouped under `rare.cart.listing`, `rare.cart.order`, and
`rare.cart.checkout`. Sellers build and sign portable Listing Root artifacts;
the platform builds and signs a fixed customer quote; the payer prepares and
executes the resulting atomic purchase. The payer is always the transaction
sender and may be a collector, processor, or another third party.

```ts
const artifact = rare.cart.listing.buildRoot({
  listings,
  chainId: rare.chainId,
  cart: rare.contracts.cart!,
  nonce,
  deadline,
});
const signedListings = await rare.cart.listing.signRoot(artifact, sellerSigner);

// Signed artifacts are JSON-safe for order-book storage. At checkout, select
// leaves from one or more roots and assemble the contract witnesses.
const storedArtifact = rare.cart.listing.parseArtifact(JSON.stringify(signedListings));
const { listings: selectedListings, authorization } = rare.cart.listing.buildAuthorization([
  { artifact: storedArtifact, listingDigest: storedArtifact.entries[0].listingDigest },
  { artifact: storedArtifact, listingDigest: storedArtifact.entries[1].listingDigest },
]);

const route = rare.utils.cart.buildRoute({ paymentCurrency, legs });
const unsigned = rare.cart.order.build({
  orderId,
  paymentCurrency,
  paymentAmount,
  deadline,
  lines,
  route,
  actions,
});
const signedOrder = await rare.cart.order.sign(unsigned, platformSigner);

const preparation = await rare.cart.checkout.prepare({
  ...signedOrder,
  listings: selectedListings,
  authorization,
});
if (preparation.ready) {
  await rare.cart.checkout.execute({
    ...signedOrder,
    listings: selectedListings,
    authorization,
    autoApprove: true,
  });
}
```

`autoApprove` defaults to `false`. Cart collects the exact platform-signed
`paymentAmount`; settlement recipients receive their exact signed Order Line
amounts, while favorable routing variance is protocol spread. Pure portable
builders are also available from `@rareprotocol/rare-sdk/utils`.
Methods return structured results and reject on RPC, API, wallet, or validation
failure.

Backend integrations can use the same `utils` entry point for Cart protocol
hashing and verification: `buildCartEip712Domain`, `hashCartListing`,
`hashCartListingRoot`, `hashCartPurchaseOrder`, `hashCartOrderLines`,
`hashCartPayoutRoute`, `hashCartFulfillmentActions`,
`deriveCartListingMerkleLeaf`, `computeCartListingMerkleRoot`, and
`verifyCartListingMerkleProof`. Chain-bound helpers accept safe numeric chain
IDs or bigint chain IDs without numeric coercion.

The package intentionally exposes only these supported entry points:

| Import | Contents |
| --- | --- |
| `@rareprotocol/rare-sdk` (or `./client`) | `createRareClient` + SDK namespaces |
| `@rareprotocol/rare-sdk/contracts` | contract addresses + ABIs per chain |
| `@rareprotocol/rare-sdk/utils` | public helpers |
| `@rareprotocol/rare-sdk/data-access` | typed Rare API client and errors |

Implementation modules, including planners, shell helpers, individual ABI
files, and data-access internals, are private. Consumers should use only the
documented root, `client`, `contracts`, `utils`, and `data-access` entry points.

Catchable approval errors, including `MinterApprovalRequiredError`, are exported
from the root package and `@rareprotocol/rare-sdk/client`.

### Transaction approvals

Write methods do not send ERC-20 allowance, NFT operator, or collection minter
approval transactions unless the caller explicitly passes `autoApprove: true`.
When an approval is required, the default behavior is to reject with the
corresponding exported `PaymentApprovalRequiredError`,
`NftApprovalRequiredError`, or `MinterApprovalRequiredError`. This lets an
application obtain user consent before retrying:

```ts
try {
  await rare.listing.create(params);
} catch (error) {
  if (error instanceof NftApprovalRequiredError) {
    // Ask the user for consent, then retry intentionally.
    await rare.listing.create({ ...params, autoApprove: true });
  }
}
```

Callers that intentionally want the previous one-call behavior can pass
`autoApprove: true` on approval-capable writes, including swap token sells and
liquid-edition deployment with initial RARE liquidity.

### Lazy ERC-721 deployment variants

`rare.collection.deploy.lazyErc721` exposes the implementation choice as
`variant`: `standard`, `royalty-guard`, or `deadman-royalty-guard`. The former
public `contractType` field and its `lazy-*` values are not accepted.

```ts
await rare.collection.deploy.lazyErc721({
  name: 'Release Collection',
  symbol: 'REL',
  maxTokens: 1000,
  variant: 'royalty-guard',
});
```

### Crypto values use bigint base units

Public SDK prices, payment amounts, swap inputs, liquid-edition supplies, and
royalty sale prices accept `bigint` base units only. Convert user-facing
decimal values before calling the SDK; for example, use viem's `parseEther` or
`parseUnits` with the selected ERC-20 currency's decimals.

```ts
import { parseEther, parseUnits } from 'viem';

await rare.listing.create({
  contract: '0x…',
  tokenId: 1n,
  price: parseEther('0.5'),
});

await rare.offer.create({
  contract: '0x…',
  tokenId: 1n,
  currency: 'usdc',
  price: parseUnits('12.50', 6),
});
```

Serialized batch-listing artifacts retain string amounts because JSON cannot
represent bigint values; live SDK method inputs are bigint-only.

### Batch marketplace creation

Batch listing, auction, and offer creation use the same token-tree artifact
produced by `rare.utils.tree.build`. Marketplace terms stay in the method
parameters instead of being embedded in a listing-specific registration
artifact:

```ts
await rare.listing.batch.create({
  artifact: tokenTreeArtifact,
  price: parseEther('0.012'),
  currency: 'eth',
  splitAddresses,
  splitRatios,
});
```

The previous mixed batch-listing root artifact is not accepted by the V2
create method. Portable token-tree artifacts remain reusable across listing,
auction, and offer creation.

Liquid-edition curve configuration helpers are available both as standalone
utilities and on a configured client:

```ts
import { getCurvePresetDefinition, parseCurveConfig } from '@rareprotocol/rare-sdk/utils';

const preset = getCurvePresetDefinition('medium-demand');
const segments = parseCurveConfig(curveJson, '1000000', 60);

const samePreset = rare.utils.liquidCurve.getPresetDefinition('medium-demand');
const sameSegments = rare.utils.liquidCurve.parseConfig({
  value: curveJson,
  totalCurveSupplyTokens: '1000000',
  tickSpacing: 60,
});
```

## Regenerating the Rare API types

The generator reads `RARE_API_BASE_URL` from the process environment, then from
a local `.env`, and otherwise uses `https://api.superrare.com`. Values are parsed
as data rather than evaluated by a shell.

```bash
npm run generate:types
```

## Reference documentation

Generate API reference Markdown directly from the public SDK source:

```bash
npm run docs:build
```

The generated reference is written to `docs/reference/`.

## Development and releases

Use Node 22 or newer and install the lockfile with `npm ci`. Before opening a
pull request or preparing a release, run:

```bash
npm run typecheck
npm run lint
npm test
npm run docs:build
npm run package:check
```
