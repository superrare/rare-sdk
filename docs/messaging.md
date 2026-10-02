# Direct messages and private groups

Messaging is account-based and independent of the selected blockchain. Use
`rare.messaging` or `createMessagingClient` without a wallet. The API must have
messaging enabled, and the caller must be included in any pilot allowlist.
Creator memberships, paid rooms and public creator communities are outside this
release. Group participation is still an authorization requirement.

## Authentication

SuperRare session cookies authorize messaging. Construct the transport inside
each server request; never cache a client that retains someone else's cookies.
Connect bearer tokens do not authorize messaging.

```typescript
import { createMessagingClient } from '@rareprotocol/rare-sdk';

const messaging = createMessagingClient({
  baseUrl: process.env.RARE_API_URL,
  fetch: (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('Cookie', incomingSessionCookies); // nglsid, zk, sessionId only
    return fetch(new Request(request, { headers, cache: 'no-store' }));
  },
});
const inbox = await messaging.inbox();
```

Only forward cookies to your trusted Rare API. Browser applications should use
a same-origin adapter with session and CSRF protection. Long-lived account-bound
interfaces should send `X-Messaging-Actor` with the session's canonical user ID;
the API rejects a stale actor if the authenticated account changes.

## Requests and invitations

`direct` sends a text introduction. Follower permissions determine whether a DM
opens directly or awaits acceptance. `createRoom` accepts only `kind: 'group'`;
invitees must accept before gaining conversation access. Creating the owner's
room does not mean invitees have joined. Honor the returned capabilities and
pending invitation/request state.

## Reliable messages

Generate one UUID per logical send and retain the full payload until success.
Explicit retries reuse both that UUID and payload; a changed payload with the
same UUID returns 409. The SDK never automatically retries writes.

```typescript
const pending = {
  clientMessageId: crypto.randomUUID(),
  body: 'Hello from the studio',
  attachmentIds: [],
  mentionUserIds: [],
};
const message = await messaging.send(conversationId, pending);
```

Load history with `conversation`, then poll `changes` using its change cursor.
Merge messages by ID before advancing the cursor; reload when `resynchronize`
is true. Compare `viewerPolicyVersion` on each response because blocking or
report hiding can change without a shared room event. Clear private caches on
logout/account change and stop rendering history, pins and images when read
access is revoked. Respect 429 and back off on failed reads.

## Images and reporting

`previewLink` explicitly requests a preview for a URL in a conversation. Ordinary
clickable links need no fetch. Include the returned reference or preview ID in
the send payload; the API checks availability, ownership and expiry again.

`uploadImage` accepts static PNG/JPEG/WebP up to 10 MB. Upload first, then bind
up to four ordered attachment identifiers to one send. `image` returns
authenticated bytes; never move private images into a public CDN.

Users report through `messageCommand`. The moderation methods are restricted
backend support endpoints, never ordinary group-owner permissions. The launch
moderation workflow delivers evidence and actions inside the configured Slack
channel; there is no separate browser moderator interface.

These contracts require the matching standalone chat API deployment and private
storage provisioning. SDK builds and passing tests do not mean chat is enabled
on production, and this change does not publish a package.
