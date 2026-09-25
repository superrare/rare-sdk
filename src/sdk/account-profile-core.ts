import { isAddress } from 'viem';
import { isRecord, RareAuthError, requireString } from './account-auth-core.js';
import type { RareAccountProfile, RareAccountProfilePatch } from './types/account.js';

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new RareAuthError(`invalid_${field}`);
  return value;
}

export function parseAccountProfile(value: unknown): RareAccountProfile {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.profile)) {
    throw new RareAuthError('invalid_profile_response');
  }
  const data = value.data;
  const profile = value.data.profile;
  const accountId = requireString(data.accountId, 'account_id');
  const address = requireString(data.address, 'address');
  if (!/^[1-9]\d*$/.test(accountId) || !isAddress(address, { strict: false })) {
    throw new RareAuthError('invalid_profile_identity');
  }
  return {
    accountId,
    address,
    username: requireString(data.username, 'username'),
    email: nullableText(data.email, 'email'),
    profile: {
      displayName: nullableText(profile.displayName, 'display_name'),
      bio: nullableText(profile.bio, 'bio'),
      avatarUrl: nullableText(profile.avatarUrl, 'avatar_url'),
    },
  };
}

/** Checks the public patch shape; backend remains authoritative for field constraints. */
export function validateAccountProfilePatch(value: unknown): asserts value is RareAccountProfilePatch {
  if (!isRecord(value) || Object.keys(value).length === 0 ||
      Object.keys(value).some(key => key !== 'username' && key !== 'profile')) {
    throw new RareAuthError('invalid_profile_patch');
  }
  if ('username' in value && (typeof value.username !== 'string' || value.username.trim().length === 0)) {
    throw new RareAuthError('invalid_username');
  }
  if ('profile' in value) {
    if (!isRecord(value.profile) || Object.keys(value.profile).length === 0 ||
        Object.entries(value.profile).some(([key, field]) =>
          !['displayName', 'bio', 'avatarUrl'].includes(key) || (field !== null && typeof field !== 'string'))) {
      throw new RareAuthError('invalid_profile_patch');
    }
  }
}
