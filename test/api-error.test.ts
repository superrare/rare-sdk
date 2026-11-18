import { describe, expect, it } from 'vitest';
import { parseApiError, RareApiError } from '../src/data-access/errors.js';
import { parseAuthErrorCode } from '../src/sdk/account-auth-core.js';

describe('application error compatibility', () => {
  it('accepts legacy and additive responses without changing the error message', () => {
    expect(parseApiError({ error: 'Missing resource' })).toEqual({ error: 'Missing resource' });
    const body = { error: 'Missing resource', code: 'not_found', details: [{ field: 'id', message: 'Unknown resource' }] };
    expect(parseApiError(body)).toEqual(body);
    const error = new RareApiError(body.error, 404, '/v1/resource', body.code, body.details);
    expect(error.message).toBe('API error 404 on /v1/resource: Missing resource');
    expect(error.code).toBe('not_found');
    expect(error.details).toEqual(body.details);
  });
  it('ignores malformed additive fields and non-JSON envelopes', () => {
    expect(parseApiError({ error: 'Legacy', code: {}, details: ['invalid'] })).toEqual({ error: 'Legacy' });
    expect(parseApiError(null)).toEqual({});
  });
  it('recognizes application codes while preserving OAuth and legacy fallbacks', () => {
    expect(parseAuthErrorCode({ code: 'service_unavailable', error: 'Upload service unavailable' })).toBe('service_unavailable');
    expect(parseAuthErrorCode({ error: 'slow_down' })).toBe('slow_down');
    expect(parseAuthErrorCode({ error: 'account_required' })).toBe('account_required');
    expect(parseAuthErrorCode({ code: 'arbitrary server secret', error: 'arbitrary server secret' })).toBe('request_failed');
  });
});
