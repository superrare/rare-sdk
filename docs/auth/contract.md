# Shared account authentication contract — delivery v1

Status: shared implementation contract, 2026-09-24. Wire changes must be coordinated across the authority, API, SDK and CLI.

## Authority and migration
New isolated Node/ESM oidc-provider package in auth repository, persistent Redis namespace separate from legacy auth. Preserve legacy routes/cookies and current Connect/SuperRare flows. No deployment. New feature configuration is disabled/fail-closed when absent. Pinned supported library release; validate custom wallet grant and device approval bridge before committing to unsupported internals.

`authBaseUrl` is full issuer base including `/auth/v2`, explicitly configured by SDK/CLI. `apiBaseUrl` is Rare API origin/base. Production host/routing/key provisioning is deployment work. HTTPS required except loopback local development; no credential-bearing redirects. Static public clients `rare-cli` and `rare-sdk`; no dynamic registration. Requested scope `rare:account offline_access`. Fixed configured resource is Rare API audience. Sessions/SDK persisted envelopes are bound to authority, client and API base.

## Public authority API
- POST `/wallet/challenge` JSON `{client_id,address,chain_id}` -> `{challenge_id,message,expires_in:300}`. Store exact issued SIWE message, address, chain, client and resource; nonce single-use. Signing domain and URI use issuer URL (domain host, uri full issuer). Native callers do not forge Origin. Browser calls restricted to configured origins.
- POST `/token` form-urlencoded wallet grant `{grant_type:'urn:superrare:params:oauth:grant-type:siwe',client_id,challenge_id,message,signature}`.
- POST `/device/authorization` form-urlencoded `{client_id,scope:'rare:account offline_access'}` -> RFC8628 `{device_code,user_code,verification_uri,verification_uri_complete?,expires_in:600,interval:5}`.
- POST `/token` form-urlencoded device grant `{grant_type:'urn:ietf:params:oauth:grant-type:device_code',client_id,device_code}`. OAuth pending/slow_down/denied/expired errors.
- POST `/token` form-urlencoded refresh `{grant_type:'refresh_token',client_id,refresh_token}`.
- All successful token responses `{access_token,token_type:'Bearer',expires_in:300,refresh_token,scope:'rare:account offline_access'}`. No credentials in URLs/logs. Cache-Control no-store.
- POST `/revoke` form-urlencoded `{client_id,token:refreshToken,token_type_hint:'refresh_token'}` -> empty 200, revoke whole grant family; unknown token also 200. Never revoke another client's token family.
- POST `/introspect` form-urlencoded `{token:accessToken}`, dedicated confidential rare-api client HTTP Basic credentials. Returns `{active:false}` or `{active:true,sub:decimalAccountId,client_id,scope,iss,aud,exp,address,chain_id,sid}`; chain_id is a positive integer number. JSON response no-store. Active verifies both token and current family/address binding. Auth agent must prove provider can supply claims and immediate family revocation; if JWT introspection cannot, adapt internally without changing API.
- GET `/jwks` public keys; standard issuer discovery as provider supports.

Wallet verification EOA then EIP1271/6492 on signed allowlisted chain only. Canonical existing account model remains address-global (not chain-qualified). Never use a different chain's successful verification as proof on requested chain; no linking or email identity merge.

Policy: 5-minute access/challenge, 10-minute device, 30-day refresh idle, 365-day absolute family maximum. Strict rotation, replay revokes family; ambiguous lost refresh response requires reauthentication (no silent retry). Atomic consumption and revocation fencing across instances. SDK/CLI serialize refresh using shared store lock. API does online introspection per request; unavailable authority means 503, inactive token means 401. In-flight operations cannot be retroactively cancelled.

## Account provisioning and API
Auth -> Rare API POST `/internal/v1/accounts/resolve`, dedicated Bearer provisioning credential (not browser token), JSON `{address,chainId}` -> `{accountId,address,username,created}`. IDs positive decimal strings, lowercase address. Atomic DB creation of account + address, unique-conflict reread, no reassignment, compromised address rejected. Email not required. Existing account data preserved. No legacy token-to-new-token exchange.

GET/PATCH `/v1/me` new bearer credentials only. Response `{data:{accountId,address,username,email,profile:{displayName,bio,avatarUrl}}}`. Email and three profile fields nullable. Authenticated address is verified and must belong to sub, not compromised. Strict PATCH `{username?,profile?:{displayName?:string|null,bio?:string|null,avatarUrl?:string|null}}`, at least one field; omission preserves, null clears. Email mutation deferred. Backend maps existing metadata, validates limits, handles unique username 409, atomic merge preserving unrelated keys. 400 invalid input; 401 invalid auth; 403 compromised/forbidden; 409 conflict; 503 upstream unavailable. Private responses no-store. No caller accountId/address fields.

## Hosted approval
New `/device` UI in connect-com. Reuse Reown configured provider/social/email/wallet connection; sign a fresh v2 SIWE challenge rather than exchanging legacy sessions. Explicit reviewed approve/deny, requesting app/user code/account displayed; account switch invalidates review. Same-origin protected server proxy (Origin/CSRF) to authority bridge. Proof binds decision to exact interaction/device request. Never return CLI token/device secret to browser, accept browser-selected accountId, or follow arbitrary return URL.

The Connect server uses a dedicated bridge Bearer credential for issuer-relative endpoints:
- POST `/internal/device/reviews` with `{user_code}` returns `{review_id,client_id,client_name,user_code,scope,expires_in}`.
- POST `/internal/device/reviews/:reviewId/challenge` with `{address,chain_id}` returns a fresh review-bound wallet challenge.
- POST `/internal/device/reviews/:reviewId/decision` accepts `{decision:'approve',challenge_id,message,signature}` or `{decision:'deny'}` and returns the corresponding status.

Review capabilities remain in protected state, never URLs or logs. Device-bound proofs cannot be redeemed by the public wallet grant. The authority uses a distributed one-time claim for each normalized user code and separately consumes the review decision. Ambiguous decisions require a new device login. The pinned provider's interaction/form/resume integration is covered by authority tests; the auth repository's `docs/auth-v2-device-bridge.md` documents the server mechanism.

## SDK / CLI
Chain-independent `createRareAccountClient`; legacy createRareClient unchanged. Session store `get/set/clear/withLock`; read-after-lock and await durable writes. No user signing/waiting under session lock. All session fields sensitive. Credential envelope includes authBaseUrl,apiBaseUrl,clientId,accessToken,refreshToken,expiresAt(epoch ms),scope and a revision. A durable write-ahead `refreshBlocked` marker prevents replay after a crashed or ambiguous refresh; the retained credential may still be explicitly revoked. Logout writes a nonsecret revision tombstone to fence pending login completion across processes.

Device state includes expiry/interval/nextPollAt, session revision and issuer/client/API binding, allowing separate start/poll/resume commands. SDK poll returns updated state for persistence; obey server cadence across invocations. CLI stores pending state under a separate lock, no device tokens in argv/stdout. JSON only safe result objects. Logout retains credentials on transport failure for retry; explicit local clear available.

## Verification / rollout
Real Redis protocol/race tests; real Postgres account/profile integration; SDK local HTTP tests plus cross-repo real integration; CLI process tests; hosted browser state/CSRF tests. Social-provider same-wallet continuity requires an authenticated external test and must be reported if unverified. No private signing keys or credentials checked in. Deliver configuration templates with empty defaults and docs, not production activation. Preserve existing test suites. SDK release dependency for CLI coordinated before PR completion.
