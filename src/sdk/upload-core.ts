import { isRecord, RareAuthError, requireString } from './account-auth-core.js';
import type { RareUpload } from './types/account.js';

export function planUpload(file: Uint8Array | Blob, filename: string, contentType?: string): { file: Blob; filename: string } {
  const size = file instanceof Blob ? file.size : file.byteLength;
  const type = (contentType ?? (file instanceof Blob ? file.type : '')) || 'application/octet-stream';
  if (size === 0 || size > 20 * 1024 * 1024 || filename.length === 0 || filename.length > 255 ||
      /[/\\\r\n]/.test(filename) || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type)) throw new RareAuthError('invalid_upload');
  return { file: file instanceof Blob ? file.slice(0, size, type) : new Blob([new Uint8Array(file)], { type }), filename };
}

export function parseUpload(value: unknown): RareUpload {
  if (!isRecord(value)) throw new RareAuthError('invalid_upload_response');
  const key = requireString(value.key, 'upload_key');
  const url = requireString(value.url, 'upload_url');
  const contentType = requireString(value.contentType, 'upload_content_type');
  if (!/^[a-f0-9]{64}$/.test(key) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0)
    throw new RareAuthError('invalid_upload_response');
  const previewUrl = value.previewUrl === null ? null : requireString(value.previewUrl, 'upload_preview_url');
  for (const source of [url, previewUrl]) {
    if (source === null) continue;
    const parsed = new URL(source);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new RareAuthError('invalid_upload_response');
  }
  return { key, url, previewUrl, contentType, size: value.size };
}
