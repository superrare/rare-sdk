import { describe, expect, it } from 'vitest';
import { normalizePostId, planCreatePost, postText, parsePost, parsePostPage, parsePostDeleted } from '../src/sdk/posts-core.js';

describe('creator post planning and response parsing', () => {
  it('validates and normalizes before writes', () => {
    expect(planCreatePost({ title: ' Title ', body: ' **Markdown** ', imageUrls: ['https://example.com/image.png'] })).toEqual({ title: 'Title', body: '**Markdown**', imageUrls: ['https://example.com/image.png'] });
    expect(() => planCreatePost({ title: 'Title', body: 'Body', imageUrls: ['javascript:alert(1)'] })).toThrow();
    expect(() => planCreatePost({ title: 'Title', body: 'Body', imageUrls: Array.from({ length: 6 }, () => 'https://example.com/a') })).toThrow();
    expect(() => postText('x'.repeat(1001), 1000)).toThrow();
    for (const id of ['0', '-1', '1e3', '9223372036854775808', '../me']) expect(() => normalizePostId(id)).toThrow();
    expect(normalizePostId('9223372036854775807')).toBe('9223372036854775807');
  });
  it('projects public fields and rejects malformed responses', () => {
    const row = { id: '1', creatorUserId: '2', title: 'Title', body: 'Body', imageUrl: null, imageUrls: [], commentCount: 0, likeCount: 0, publishedAt: '2026-10-02T00:00:00Z', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', email: 'private@example.com' };
    expect(parsePost(row)).not.toHaveProperty('email');
    expect(() => parsePost({ ...row, likeCount: -1 })).toThrow();
    expect(() => parsePostPage({ data: [row], pagination: { page: 1, perPage: 101, totalCount: 1, totalPages: 1 } }, parsePost)).toThrow();
    expect(() => parsePostDeleted({ data: { deleted: false } })).toThrow();
  });
});
