import { isRecord, RareAuthError, requirePositiveNumber, requireString } from './account-auth-core.js';
import type { RareAccountSession, RareAccountSessionStore, RareStoredAccountSession } from './types/account.js';

export function parseAccountSession(value: unknown, authBaseUrl: string, clientId: string, apiBaseUrl: string): RareAccountSession | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new RareAuthError('invalid_session');
  if (value.authBaseUrl !== authBaseUrl || value.clientId !== clientId || value.apiBaseUrl !== apiBaseUrl) {
    throw new RareAuthError('session_authority_mismatch');
  }
  if (value.loggedOut === true) return null;
  if (value.refreshBlocked !== undefined && value.refreshBlocked !== true) throw new RareAuthError('invalid_session');
  return {
    revision: requireString(value.revision, 'session_revision'),
    authBaseUrl,
    apiBaseUrl,
    clientId,
    accessToken: requireString(value.accessToken, 'access_token'),
    refreshToken: requireString(value.refreshToken, 'refresh_token'),
    expiresAt: requirePositiveNumber(value.expiresAt, 'expires_at'),
    scope: requireString(value.scope, 'scope'),
    ...(value.refreshBlocked === true ? { refreshBlocked: true } : {}),
  };
}

/** Per-instance memory only: opt into platform-appropriate persistent storage explicitly. */
export function createMemoryAccountSessionStore(): RareAccountSessionStore {
  // Mutable state is confined to the storage adapter; all parsing stays pure.
  // eslint-disable-next-line functional/no-let
  let session: RareStoredAccountSession | null = null;
  // eslint-disable-next-line functional/no-let
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async get() { return session === null ? null : { ...session }; },
    async set(value) { session = { ...value }; },
    async clear() { session = null; },
    withLock<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
