import { createApiClient, RareApiError } from '../data-access/index.js';
import { resolveRareApiBaseUrl } from '../data-access/base-url.js';
import type { operations } from '../data-access/schema.js';

type JsonBody<Operation> = Operation extends { requestBody: { content: { 'application/json': infer Body } } } ? Body : never;
export type MessagingSend = JsonBody<operations['sendMessagingMessage']>;
export type MessagingCommand = JsonBody<operations['executeMessagingCommand']>;
export type MessagingMessageCommand = JsonBody<operations['executeMessagingMessageCommand']>;
export type MessagingCreateDirect = JsonBody<operations['createMessagingDirect']>;
export type MessagingCreateRoom = JsonBody<operations['createMessagingRoom']>;
export type MessagingMessage = operations['sendMessagingMessage']['responses'][200]['content']['application/json'];
export type MessagingConversation = operations['createMessagingRoom']['responses'][200]['content']['application/json'];
export type MessagingPage = operations['getMessagingConversation']['responses'][200]['content']['application/json'];
export type MessagingAttachment = operations['uploadMessagingImage']['responses'][200]['content']['application/json'];
export type MessagingChanges = operations['getMessagingChanges']['responses'][200]['content']['application/json'];

export type MessagingClientOptions = {
  baseUrl?: string;
  /** Request-scoped authenticated transport. Never retain another user's cookies. */
  fetch?: typeof globalThis.fetch;
};

const requiredData = async <Data>(result: Promise<{ data?: Data }>): Promise<Data> => {
  const { data } = await result;
  if (data === undefined) throw new Error('Messaging response was empty');
  return data;
};

/**
 * Account-based messaging, independent of the client's selected chain.
 * SuperRare session cookies are required. Connect bearer tokens do not yet
 * authorize messaging. Mutations never retry automatically; reuse the same
 * clientMessageId and payload for an explicit send retry.
 */
export function createMessagingClient(options: MessagingClientOptions = {}) {
  const client = createApiClient(options.baseUrl, options.fetch);
  const headers = { 'X-Messaging-Request': '1' };
  const binaryRequest = async (path: string, body?: Blob) => {
    const request = new Request(`${resolveRareApiBaseUrl(options.baseUrl).replace(/\/$/, '')}/v1/messaging${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      ...(body === undefined ? {} : { body }),
      cache: 'no-store',
    });
    const response = await (options.fetch ?? globalThis.fetch)(request);
    if (!response.ok) throw new RareApiError('Messaging image request failed', response.status, path);
    return response;
  };
  return {
    session: () => requiredData(client.GET('/v1/messaging/session', { cache: 'no-store' })),
    inbox: (query: operations['listMessagingConversations']['parameters']['query'] = {}) =>
      requiredData(client.GET('/v1/messaging/conversations', { params: { query }, cache: 'no-store' })),
    people: (search: string) => requiredData(client.GET('/v1/messaging/people', { params: { query: { search } }, cache: 'no-store' })),
    direct: (body: MessagingCreateDirect) => requiredData(client.POST('/v1/messaging/direct', { body, headers })),
    createRoom: (body: MessagingCreateRoom) => requiredData(client.POST('/v1/messaging/rooms', { body, headers })),
    creatorRooms: (userId: string) => requiredData(client.GET('/v1/messaging/creators/{userId}/rooms', { params: { path: { userId } }, cache: 'no-store' })),
    conversation: (conversationId: string, query: operations['getMessagingConversation']['parameters']['query'] = {}) =>
      requiredData(client.GET('/v1/messaging/conversations/{conversationId}', { params: { path: { conversationId }, query }, cache: 'no-store' })),
    changes: (conversationId: string, after: string) =>
      requiredData(client.GET('/v1/messaging/conversations/{conversationId}/changes', { params: { path: { conversationId }, query: { after } }, cache: 'no-store' })),
    participants: (conversationId: string, after?: string, search?: string) =>
      requiredData(client.GET('/v1/messaging/conversations/{conversationId}/participants', { params: { path: { conversationId }, query: { after, search } }, cache: 'no-store' })),
    command: (conversationId: string, body: MessagingCommand) =>
      requiredData(client.POST('/v1/messaging/conversations/{conversationId}/commands', { params: { path: { conversationId } }, body, headers })),
    send: (conversationId: string, body: MessagingSend) =>
      requiredData(client.POST('/v1/messaging/conversations/{conversationId}/messages', { params: { path: { conversationId } }, body, headers })),
    messageCommand: (conversationId: string, messageId: string, body: MessagingMessageCommand) =>
      requiredData(client.POST('/v1/messaging/conversations/{conversationId}/messages/{messageId}/commands', { params: { path: { conversationId, messageId } }, body, headers })),
    block: (userId: string, blocked: boolean) =>
      requiredData(client.POST('/v1/messaging/blocks/{userId}', { params: { path: { userId } }, body: { blocked }, headers })),
    reports: (cursor?: string) => requiredData(client.GET('/v1/messaging/reports', { params: { query: { cursor } }, cache: 'no-store' })),
    report: (reportId: string) => requiredData(client.GET('/v1/messaging/reports/{reportId}', { params: { path: { reportId } }, cache: 'no-store' })),
    moderate: (reportId: string, body: JsonBody<operations['moderateMessagingReport']>) =>
      requiredData(client.POST('/v1/messaging/reports/{reportId}/commands', { params: { path: { reportId } }, body, headers })),
    blocks: () => requiredData(client.GET('/v1/messaging/blocks', { cache: 'no-store' })),
    uploadImage: async (conversationId: string, image: Blob): Promise<MessagingAttachment> => {
      if (image.size === 0 || image.size > 10 * 1024 * 1024) throw new Error('Choose an image up to 10 MB');
      const response = await binaryRequest(`/conversations/${encodeURIComponent(conversationId)}/attachments`, image);
      const value: unknown = await response.json();
      if (typeof value !== 'object' || value === null ||
        !('id' in value) || typeof value.id !== 'string' ||
        !('contentType' in value) || typeof value.contentType !== 'string' ||
        !('sizeBytes' in value) || typeof value.sizeBytes !== 'number' ||
        !('width' in value) || typeof value.width !== 'number' ||
        !('height' in value) || typeof value.height !== 'number') throw new Error('Invalid messaging image response');
      return { id: value.id, contentType: value.contentType, sizeBytes: value.sizeBytes, width: value.width, height: value.height };
    },
    image: async (attachmentId: string): Promise<Blob> =>
      (await binaryRequest(`/attachments/${encodeURIComponent(attachmentId)}`)).blob(),
  };
}

export type MessagingClient = ReturnType<typeof createMessagingClient>;
