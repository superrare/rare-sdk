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

## Account authentication (new authority)

`createRareAccountClient` exposes account operations without an RPC connection or
transaction wallet. All requests use one public API base URL. Rare API forwards
`/auth/v2` login, device, refresh and revocation requests to the existing auth
service; profile requests use `/v1/me`. Legacy SuperRare/Connect cookies and tokens
are not accepted by this client.

```ts
import { createRareAccountClient } from '@rareprotocol/rare-sdk';

const account = createRareAccountClient(); // https://api.superrare.com
const authorization = await account.auth.startDeviceAuthorization();
// Display authorization.verificationUri and authorization.userCode, or open
// authorization.verificationUriComplete in a browser using your application's UI.
await account.auth.waitForDeviceAuthorization(authorization);
const profile = await account.profile.get();
await account.profile.update({ profile: { bio: 'Artist and collector' } });
await account.auth.logout();
```

For the development environment, set only the API base:

```ts
const account = createRareAccountClient({
  apiBaseUrl: 'https://rare-api-devmainnet-784573620320.us-east1.run.app',
});
```

Auth is always derived as `<apiBaseUrl>/auth/v2`; there is no separate auth URL
option. A feature deployment can supply its own API base with the same routes.
Sessions from the earlier direct-auth URL are bound to that old issuer and require
fresh login; they are not silently reused under the API issuer.

For direct wallet login, supply a signer; no transaction is submitted:

```ts
await account.auth.loginWithWallet({
  address: walletAccount.address,
  chainId: 1,
  signMessage: (message) => walletAccount.signMessage({ message }),
});
```

Browser-approved login supports the hosted application's wallet, social, and email
options. Social providers and cross-origin account continuity require deployment
configuration and verification; the SDK itself does not hold social credentials.

Sessions default to instance-local memory. Persist them by supplying a
`RareAccountSessionStore`. `withLock` must serialize **all** operations across
clients/processes sharing a store; reads happen after lock acquisition and writes
must finish durably before resolving. Scope the store by normalized auth base,
API base, and client ID. Store values can be credentials or a nonsecret logout
tombstone (`RareStoredAccountSession`); retain the latter to prevent an old login
from resurrecting a session after another process logs out. Use `auth.getSession()`
for local status; it returns `null` for a logged-out store. It is not a server
validation call and its non-null result contains secrets—never print it wholesale.

The SDK proactively refreshes near-expired credentials under that lock. It durably
marks `refreshBlocked: true` before sending the refresh and clears the marker only
after saving the replacement credentials. An ambiguous refresh failure raises
`RareAuthError` with `code: 'reauthentication_required'`; it never automatically
replays a potentially consumed refresh token. The remaining credential can be used
for explicit logout. A completely unavailable store may require local recovery
before reuse. Logout revokes remotely before replacing credentials with a tombstone;
on network failure credentials remain for retry. `auth.clearSession()` removes
local credentials without claiming server revocation. Explicit successful login
replaces the local session; an older server session is not automatically revoked.

For resumable device flows, persist `RareDeviceAuthorization` securely and call
`auth.pollDeviceAuthorization(state)`. Pending, slow-down and transport-retry results return updated
`authorization` state, including `nextPollAt` and `interval`; save it before the next
invocation. Serialize access to a pending request separately from session storage.
An `authorized` result has already been saved to the session store. The built-in
wait method handles polling but does not persist intermediate device state.
Device codes and token responses must not appear in logs, URLs, or command arguments.

Network methods accept `{ signal }` for cancellation and use a 30-second request
timeout. Device waits also stop at grant expiry. Only HTTPS endpoints (or loopback
HTTP for development) are accepted, and credential requests do not follow redirects.
Profile writes are never automatically replayed. Omitted patch fields preserve data;
`null` clears nullable profile fields. Email and account/wallet ownership are not
editable through this first profile surface.

Existing `createRareClient` wallet transactions and public reads are unchanged.
An account session does not delegate transaction-signing authority.
