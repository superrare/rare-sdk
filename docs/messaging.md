# Messaging

Messaging is account-based and does not change with the selected blockchain.
Use `rare.messaging` on a Rare client, or `createMessagingClient` without a wallet.
The API must have messaging enabled and the caller must be included in any pilot allowlist.

## Session authentication

SuperRare session cookies authorize these endpoints. Create the transport inside each server request;
never cache a client that closes over a person's cookies. Browser Connect bearer tokens are not
authorized for messaging until messaging consent and scopes are released.

```typescript
import { createMessagingClient } from '@rareprotocol/rare-sdk';

const messaging = createMessagingClient({
  baseUrl: process.env.RARE_API_URL,
  fetch: (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('Cookie', incomingSessionCookies); // allowlist nglsid, zk, sessionId
    return fetch(new Request(request, { headers, cache: 'no-store' }));
  },
});
const inbox = await messaging.inbox();
```

The transport forwards cookies to your trusted Rare API only. For direct browser usage, use a
same-origin server adapter with your existing session and CSRF protection.

## Reliable sends

Generate one UUID for each logical send. Keep its complete payload until success. An explicit retry
must reuse both the UUID and the payload; reusing a UUID with different content returns 409.
The client never automatically retries writes.

```typescript
const pending = {
  clientMessageId: crypto.randomUUID(),
  body: 'Hello from the studio',
  attachmentIds: [],
  mentionUserIds: [],
};
const message = await messaging.send(conversationId, pending);
```

Use `conversation` for history and its `changeCursor`. Poll `changes`, merge messages by id,
advance the cursor only after applying a response, and reload history when `resynchronize` is true.
Also reload and clear cached history when `viewerPolicyVersion` changes; personal blocking and
report hiding can change without a shared room event. Compare it on every changes response.
Stop displaying history, pins and images whenever `capabilities.read` is false or access expires.
Discard all private caches on logout or account change. Respect 429 and back off on failures.
For long-lived account-bound interfaces, send `X-Messaging-Actor` with the session's canonical
user ID through the custom transport. The server returns 409 if the cookie identity changes.

DMs start with one text introduction through `direct`. The recipient must accept before more sends.
Groups require accepted invitations; free and paid creator rooms require explicit joining.
Paid access is checked by the API on each request. Room bans do not cancel billing.
A closed paid room freezes each joined eligible member's access cutoff; later renewals do not extend it.

`uploadImage` accepts static PNG/JPEG/WebP up to 10 MB and returns an attachment identifier.
Upload first, include that identifier in one send, and use `image` for authenticated bytes.
Do not persist or proxy these bytes into a public CDN. Moderation methods require the configured
moderator allowlist; report evidence is never available to ordinary room owners.

The web application, these SDK methods, and the generated types use the same Rare API OpenAPI
contract. A server deployment and private storage provisioning precede enabling the feature.
