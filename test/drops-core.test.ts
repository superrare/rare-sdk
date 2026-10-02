import { describe, expect, it } from 'vitest';
import { dropListQuery, normalizeDropId, planCreateDrop, planDropUpdate, parseDrop } from '../src/sdk/drops-core.js';
const metadata = { headline: ' Drop ', description: ' New art ', destinationUrl: '', imageUrl: `https://storage.googleapis.com/rare-api-upload-dev/${'a'.repeat(64)}` };
const input = { type: 'NONE' as const, startsAt: '2026-10-03T12:00:00Z', metadata };
describe('drop planners', () => {
  it('normalizes text and permits an empty destination', () => expect(planCreateDrop(input)).toEqual({ ...input, metadata: { ...metadata, headline: 'Drop', description: 'New art' } }));
  it('omits undefined patch fields and permits clearing the destination', () => expect(planDropUpdate({ startsAt: undefined, metadata: { headline: undefined, destinationUrl: '' } })).toEqual({ metadata: { destinationUrl: '' } }));
  it.each([{}, { metadata: {} }, { startsAt: 'tomorrow' }, { startsAt: '2026-02-31T12:00:00Z' }, { metadata: { headline: '' } }, { metadata: { imageUrl: 'http://example.com/image.png' } }])('rejects invalid or empty updates before I/O', value => expect(() => planDropUpdate(value)).toThrow());
  it.each(['0', '-1', '01', '1e3', '9223372036854775808'])('rejects invalid identifiers: %s', id => expect(() => normalizeDropId(id)).toThrow());
  it('plans a public calendar with an optional creator selector', () => expect(dropListQuery({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', user: { username: 'Creator' }, isCurated: false })).toMatchObject({ page: 1, perPage: 20, username: 'creator', isCurated: 'false' }));
  it('rejects wide windows and excessive page offsets', () => {
    expect(() => dropListQuery({ from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })).toThrow();
    expect(() => dropListQuery({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', page: 102, perPage: 100 })).toThrow();
  });
  it('maps only public response fields and handles legacy media', () => {
    const record = { id: '1', userId: '2', creatorAddress: `0x${'1'.repeat(40)}`, type: 'NONE', startsAt: input.startsAt, createdAt: input.startsAt, updatedAt: input.startsAt, isCurated: false, isFeatured: false, metadata: { ...metadata, imageObjectKey: 'a'.repeat(64), slug: 'drop' } };
    expect(parseDrop({ ...record, email: 'private@example.com' })).toEqual(record);
    const legacy = { ...record, metadata: { headline: 'Legacy', description: 'Legacy drop', destinationUrl: '', imageObjectKey: `announcements/${record.creatorAddress}/aabb.webp` } };
    expect(parseDrop(legacy)).toEqual(legacy);
  });
});
