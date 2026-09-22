import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMessagingClient } from '../src/sdk/messaging.js';
import { RareApiError } from '../src/data-access/errors.js';

const server = createServer(async (request, response) => {
  const body = Buffer.concat(await request.toArray()).toString();
  response.setHeader('content-type', 'application/json');
  if (request.url?.endsWith('/messages')) {
    response.writeHead(409);
    response.end(JSON.stringify({ error: { code: 'idempotency_conflict', message: JSON.stringify({ header: request.headers['x-messaging-request'], body: JSON.parse(body) }) } }));
  } else if (request.url?.endsWith('/attachments')) {
    response.end(JSON.stringify({ id: request.headers.cookie, contentType: 'image/webp', sizeBytes: body.length, width: 16, height: 16 }));
  } else {
    response.end(JSON.stringify({ user: { id: request.headers.cookie, username: 'session' } }));
  }
});
beforeAll(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); });
afterAll(async () => { server.close(); await once(server, 'close'); });
const baseUrl = (): string => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Server unavailable');
  return `http://127.0.0.1:${address.port}`;
};
const clientFor = (cookie: string, transport: typeof fetch = fetch) => createMessagingClient({
  baseUrl: baseUrl(),
  fetch: (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('Cookie', cookie);
    return transport(new Request(request, { headers }));
  },
});
describe('messaging HTTP transport', () => {
  it('keeps concurrent clients request-scoped', async () => {
    const sessions = await Promise.all([clientFor('sessionId=first').session(), clientFor('sessionId=second').session()]);
    expect(sessions.map(value => value.user.id)).toEqual(['sessionId=first', 'sessionId=second']);
  });
  it('does not automatically retry a rejected send and preserves its complete payload', async () => {
    const transport = vi.fn(fetch);
    const pending = { clientMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', body: 'Hello', attachmentIds: [], mentionUserIds: [] };
    const result = clientFor('sessionId=first', transport).send('cccccccc-cccc-4ccc-8ccc-cccccccccccc', pending);
    await expect(result).rejects.toBeInstanceOf(RareApiError);
    await expect(result).rejects.toMatchObject({ status: 409, message: expect.stringContaining(JSON.stringify({ header: '1', body: pending })) });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('uses the same private transport for typed uploads', async () => {
    const result = await clientFor('sessionId=image').uploadImage('cccccccc-cccc-4ccc-8ccc-cccccccccccc', new Blob(['encoded']));
    expect(result).toMatchObject({ id: 'sessionId=image', width: 16, sizeBytes: 7 });
  });
});
