import { describe, expect, it } from 'vitest';
import { normalizeAuthBaseUrl, parseAuthErrorCode, RareAuthError } from '../src/sdk/account-auth-core.js';

describe('authentication transport boundary', () => {
  it('allows HTTPS and loopback development origins', () => {
    expect(normalizeAuthBaseUrl('https://auth.example/v2/')).toBe('https://auth.example/v2');
    expect(normalizeAuthBaseUrl('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
    expect(normalizeAuthBaseUrl('http://[::1]:8000')).toBe('http://[::1]:8000');
  });
  it.each(['http://auth.example', 'https://user:password@auth.example', 'https://auth.example?token=secret', 'https://auth.example#secret', 'file:///tmp/auth'])('rejects unsafe URL %s', (url) => {
    expect(() => normalizeAuthBaseUrl(url)).toThrow();
  });
  it('reports signup required without treating login as a failure', () => {
    expect(parseAuthErrorCode({ error: 'account_required' })).toBe('account_required');
    const error = new RareAuthError('account_required', 403);
    expect(error.code).toBe('account_required');
    expect(error.status).toBe(403);
    expect(error.message).toContain('Complete signup');
  });
  it('does not include arbitrary server strings in errors', () => {
    expect(parseAuthErrorCode({ error: 'submitted secret value' })).toBe('request_failed');
    expect(parseAuthErrorCode({ error: 'invalid_grant' })).toBe('invalid_grant');
  });
});
