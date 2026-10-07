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

Subpath exports mirror the ones previously published by the CLI package:

| Import | Contents |
| --- | --- |
| `@rareprotocol/rare-sdk` (or `./client`) | `createRareClient` + SDK namespaces |
| `@rareprotocol/rare-sdk/contracts` | contract addresses + ABIs per chain |
| `@rareprotocol/rare-sdk/utils` | public helpers |

## Returning as soon as a transaction is broadcast

Write methods wait for the transaction receipt by default and resolve with
`{ txHash, receipt, ... }`. Pass `waitForReceipt: false` to resolve as soon as
the main transaction is broadcast, for example to record the hash of a payment
before it is mined:

```ts
const { txHash, approvalTxHash, wait } = await rare.listing.buy({
  contract: '0x…',
  tokenId: '1',
  price: '0.1',
  waitForReceipt: false,
});
// record txHash
const result = await wait();
```

- Prerequisite approvals (ERC20 allowance, NFT operator, collection minter)
  are still sent and mined first. Their hashes are returned next to `txHash`
  under the same names the full result uses: `approvalTxHash`,
  `approvalTxHashes` or `approvalResetTxHash`.
- `wait()` waits for the receipt and resolves with exactly what the call
  returns without the flag, including receipt-derived values such as token IDs,
  deployed contract addresses and parsed events. It rejects with the same
  errors: reverted receipts, missing or mismatched events, and
  `ApprovalSideEffectError` when an approval was already mined. Calling it again
  waits again, for example after an RPC timeout.
- A failed broadcast still rejects the call itself.
- Wallets that fall back to `wallet_sendCalls` (Reown social login) only
  report the hash once the bundle is confirmed, so with them the call resolves
  after the transaction is mined.
- Omitting the flag or passing `true` keeps the existing behaviour and result
  type. A literal `false` narrows the type to `SubmittedTransaction<Result>`;
  a non-literal boolean resolves to the union of both.

Every `rare.*` method that sends a transaction supports the flag. Not supported
yet: the low-level helpers exported from `@rareprotocol/rare-sdk/helpers`
(`sendPreparedTransaction`, `ensureTokenAllowance`, `preparePayment`,
`preparePaymentForSpender`, `preparePaymentAmountForSpender`,
`approveNftContractIfNeeded`) still wait for their receipts.

## Regenerating the Rare API types

Generate endpoint and response types from the production Rare API:

```bash
npm run generate:types
```

Commit the regenerated schema with SDK changes that use the updated contract.
API changes must be deployed to production before merging the corresponding SDK
support.

## Liquid edition discovery

```ts
// Uses the chain configured on rare, just like rare.search.nfts().
const editions = await rare.search.liquidEditions({
  query: 'generative',
  holderAddress: '0x1234567890123456789012345678901234567890',
  sortBy: 'priceAsc',
  priceMax: 100, // Inclusive USD bound
  perPage: 20,
});
const edition = await rare.liquidEdition.get({
  contract: '0x1234567890123456789012345678901234567890',
});
```

Search returns `{ data: LiquidEdition[], pagination }`; `get` returns the
unwrapped `LiquidEdition`. Full-text search uses `query` (sent as `q`), matching
NFT search. All API filters are supported: contract, creator and holder addresses,
approved creator and current price flags, display-price currency, inclusive USD
price bounds, media type, tags (match any), sort order, and pagination. Defaults
are page 1, 20 results (maximum 100), and `newest` sorting. Sort options are
`newest`, `oldest`, `priceAsc`, `priceDesc`, `holderCountAsc`, and `holderCountDesc`. Search text is limited
to 500 characters and tags to 50 entries. `IMAGE` includes GIFs.

For all-chain discovery, use the standalone API client and omit `chainId`:

```ts
import { createRareApi } from '@rareprotocol/rare-sdk/api';

const api = createRareApi();
const editions = await api.searchLiquidEditions({ query: 'generative' });
const edition = await api.getLiquidEdition('1-0x1234567890123456789012345678901234567890');
```

Only public editions are returned. Holder filtering uses positive indexed collector
balances, excluding system and self-holdings; responses do not contain holder
arrays or exact wallet balances. Indexed discovery may lag on-chain state; use
`rare.liquidEdition.status({ contract })` for on-chain telemetry.

Price bounds and price sorting exclude editions without a current price and
cannot be combined with `hasCurrentPrice: false`. API validation errors (`400`),
missing editions (`404`), and unavailable discovery (`503`) propagate as
`RareApiError` from `@rareprotocol/rare-sdk/data-access`, retaining `status` and
`path`. The SDK uses the production Rare API by default. Set `apiBaseUrl` on
`createRareClient`, or `baseUrl` on `createRareApi`, to use another deployment.

## Live integration tests

```bash
npm run test:integration
```

This opt-in, read-only suite targets
`https://rare-api-devmainnet-784573620320.us-east1.run.app` using two known public
Sepolia editions: **LQE 9/21** (`0x1a9e355ba82542ef9d0654347026a63b09e53b26`)
and **Liquid Lens HTML Example** (`0xeedad60508165cffebb8f8b71a68bea3cc6ad235`).
It checks both detail interfaces, response fields and GIF/HTML media, combined
search filters, match-any tags, pagination, mismatched creator exclusion, and
real `400`/`404` errors. It does not assert changing prices, supply, or balances.

Normal `npm test` skips live tests. Requests time out after 20 seconds, and API
outages or missing fixtures fail the live suite rather than silently skipping it.
Override the deployment with `RARE_API_INTEGRATION_URL`; that deployment must
contain the same fixtures. If these editions are intentionally changed or removed,
update the explicit fixtures in `test/integration/liquid-edition-discovery.test.ts`.

Liquid discovery tests follow functional core / imperative shell boundaries:
`test/liquid-discovery-core.test.ts` unit-tests pure query mapping and edition
identity construction without mocks. `test/integration/liquid-edition-discovery.test.ts`
tests the HTTP shell against the live rare-api; no responses are mocked. A `503`
is treated as an integration failure, not simulated by the suite.
