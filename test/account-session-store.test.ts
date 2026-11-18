import { describe, expect, it } from 'vitest';
import { createMemoryAccountSessionStore, parseAccountSession } from '../src/sdk/account-session-store.js';

const session = {
  revision: "test-revision",
  authBaseUrl: 'https://auth.example/v2', clientId: 'rare-cli', apiBaseUrl: 'https://api.example',
  accessToken: 'access', refreshToken: 'refresh', expiresAt: 100000, scope: 'account',
};

describe('account session persistence', () => {
  it('rejects credentials for a different authority or client before use', () => {
    expect(() => parseAccountSession(session, 'https://other.example', 'rare-cli', session.apiBaseUrl)).toThrow('session_authority_mismatch');
    expect(() => parseAccountSession(session, session.authBaseUrl, 'other-client', session.apiBaseUrl)).toThrow('session_authority_mismatch');
    expect(() => parseAccountSession({ ...session, refreshToken: '' }, session.authBaseUrl, session.clientId, session.apiBaseUrl)).toThrow('invalid_refresh_token');
  });
  it('serializes operations and recovers the queue after a failure', async () => {
    const store = createMemoryAccountSessionStore();
    const first = store.withLock(async () => {
      await store.set(session);
      throw new Error('operation failed');
    });
    const next = store.withLock(async () => {
      expect(await store.get()).toEqual(session);
      await store.clear();
    });
    await expect(first).rejects.toThrow('operation failed');
    await next;
    expect(await store.get()).toBeNull();
  });
  it('does not share memory sessions between clients', async () => {
    const first = createMemoryAccountSessionStore();
    const second = createMemoryAccountSessionStore();
    await first.set(session);
    expect(await second.get()).toBeNull();
  });
});
