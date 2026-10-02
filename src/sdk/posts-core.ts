import { isRecord, RareAuthError, requireString } from './account-auth-core.js';
import { favoritePageQuery } from './favorites-core.js';
import type { SearchPageResponse } from './api.js';
import type { components } from '../data-access/schema.js';

export type CreatorPost = components['schemas']['CreatorPost'];
export type CreatorPostComment = components['schemas']['CreatorPostComment'];
export type CreatePostInput = { title: string; body: string; imageUrls?: string[] };
export function normalizePostId(value: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new RareAuthError('invalid_post_id');
  return value;
}
export function planCreatePost(input: CreatePostInput): CreatePostInput {
  if (!isRecord(input) || Object.keys(input).some(key => !['title', 'body', 'imageUrls'].includes(key))) throw new RareAuthError('invalid_post');
  const title = postText(input.title, 120);
  const body = postText(input.body, 5000);
  if (input.imageUrls === undefined) return { title, body };
  if (!Array.isArray(input.imageUrls) || input.imageUrls.length > 5 || input.imageUrls.some(url => typeof url !== 'string' || !URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol))) throw new RareAuthError('invalid_post_images');
  return { title, body, imageUrls: [...input.imageUrls] };
}
export function postText(value: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new RareAuthError('invalid_post_text');
  return value.trim();
}
export function parsePost(value: unknown): CreatorPost {
  if (!isRecord(value) || (value.imageUrl !== null && typeof value.imageUrl !== 'string') || !Array.isArray(value.imageUrls) || !value.imageUrls.every(url => typeof url === 'string')) throw new RareAuthError('invalid_post_response');
  return {
    id: normalizePostId(requireString(value.id, 'id')), creatorUserId: normalizePostId(requireString(value.creatorUserId, 'creatorUserId')),
    title: requireString(value.title, 'title'), body: requireString(value.body, 'body'), imageUrl: value.imageUrl, imageUrls: value.imageUrls,
    commentCount: count(value.commentCount), likeCount: count(value.likeCount),
    publishedAt: requireString(value.publishedAt, 'publishedAt'), createdAt: requireString(value.createdAt, 'createdAt'), updatedAt: requireString(value.updatedAt, 'updatedAt'),
  };
}
export function parsePostComment(value: unknown): CreatorPostComment {
  if (!isRecord(value)) throw new RareAuthError('invalid_post_response');
  return {
    id: normalizePostId(requireString(value.id, 'id')), postId: normalizePostId(requireString(value.postId, 'postId')), authorUserId: normalizePostId(requireString(value.authorUserId, 'authorUserId')),
    body: requireString(value.body, 'body'), createdAt: requireString(value.createdAt, 'createdAt'), updatedAt: requireString(value.updatedAt, 'updatedAt'),
  };
}
export function parsePostData<T>(value: unknown, parse: (value: unknown) => T): T {
  if (!isRecord(value)) throw new RareAuthError('invalid_post_response');
  return parse(value.data);
}
export function parsePostPage<T>(value: unknown, parse: (value: unknown) => T): SearchPageResponse<T> {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) throw new RareAuthError('invalid_post_response');
  const pagination = value.pagination;
  const { page, perPage } = favoritePageQuery({ page: count(pagination.page), perPage: count(pagination.perPage) });
  return { data: value.data.map(parse), pagination: { page, perPage, totalCount: count(pagination.totalCount), totalPages: count(pagination.totalPages) } };
}
export function parsePostDeleted(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.data) || value.data.deleted !== true) throw new RareAuthError('invalid_post_response');
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RareAuthError('invalid_post_response');
  return value;
}
