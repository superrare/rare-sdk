/** Sensitive credentials. Never print this object in logs or status output. */
export type RareAccountSession = {
  revision: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  /** A refresh may have consumed its credential; only explicit login can restore renewal. */
  refreshBlocked?: true;
};

/**
 * Storage is bound to the configured authority and client. Persistent implementations
 * must serialize the entire operation across processes (including refresh requests).
 * Values read from storage are validated by the SDK.
 */
export type RareAccountSessionStore = {
  get: () => Promise<unknown>;
  set: (session: RareStoredAccountSession) => Promise<void>;
  clear: () => Promise<void>;
  withLock: <T>(operation: () => Promise<T>) => Promise<T>;
};

export type RareStoredAccountSession = RareAccountSession | {
  authBaseUrl: string; apiBaseUrl: string; clientId: string; revision: string; loggedOut: true;
};

export type RareDeviceAuthorization = {
  sessionRevision: string | null;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
};

export type RareDevicePollResult =
  | { status: 'pending'; authorization: RareDeviceAuthorization }
  | { status: 'retry'; authorization: RareDeviceAuthorization }
  | { status: 'slow_down'; authorization: RareDeviceAuthorization }
  | { status: 'authorized'; session: RareAccountSession };

export type RareWalletLoginOptions = {
  address: string;
  chainId: number;
  signMessage: (message: string) => Promise<string>;
};

export type RareAccountClientOptions = {
  /** Public API base; auth uses its /auth/v2 routes. Defaults to https://api.superrare.com. */
  apiBaseUrl?: string;
  clientId?: string;
  sessionStore?: RareAccountSessionStore;
  fetch?: typeof globalThis.fetch;
};

export type RareAccountProfile = {
  accountId: string;
  address: string;
  username: string;
  email: string | null;
  profile: {
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  };
};

export type RareAccountProfilePatch = {
  username?: string;
  profile?: {
    displayName?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
  };
};

export type RareAuthRequestOptions = { signal?: AbortSignal };

export type RareAccountClient = {
  auth: {
    startDeviceAuthorization: (options?: RareAuthRequestOptions) => Promise<RareDeviceAuthorization>;
    pollDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareDevicePollResult>;
    waitForDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    loginWithWallet: (options: RareWalletLoginOptions & RareAuthRequestOptions) => Promise<RareAccountSession>;
    getSession: () => Promise<RareAccountSession | null>;
    refresh: (options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    logout: (options?: RareAuthRequestOptions) => Promise<void>;
    clearSession: () => Promise<void>;
  };
  profile: {
    get: (options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
    update: (patch: RareAccountProfilePatch, options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
  };
};
