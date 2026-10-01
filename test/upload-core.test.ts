import { describe, expect, it } from 'vitest';
import { parseUpload, planUpload } from '../src/sdk/upload-core.js';

describe('shared uploads', () => {
  it('accepts arbitrary binary files and Blob content types', () => {
    expect(planUpload(new Uint8Array([0, 1, 2]), 'asset.bin').file.type).toBe('application/octet-stream');
    expect(planUpload(new Blob(['hello'], { type: 'text/plain' }), 'notes.txt').file.type).toBe('text/plain');
  });
  it('rejects unsafe names, empty files and oversized files before I/O', () => {
    expect(() => planUpload(new Uint8Array(), 'empty')).toThrow();
    expect(() => planUpload(new Uint8Array([1]), '../asset')).toThrow();
    expect(() => planUpload(new Uint8Array(20 * 1024 * 1024 + 1), 'large')).toThrow();
  });
  it('parses stored metadata and rejects malformed results', () => {
    const result = { key: 'a'.repeat(64), url: 'https://storage.googleapis.com/bucket/key', previewUrl: null, contentType: 'application/octet-stream', size: 3 };
    expect(parseUpload(result)).toEqual(result);
    expect(() => parseUpload({ ...result, size: -1 })).toThrow();
    expect(() => parseUpload({ ...result, url: 'javascript:alert(1)' })).toThrow();
  });
});
