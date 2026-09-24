import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export async function verifyCli({ authBaseUrl, apiBaseUrl, bridge, wallet, accountId }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rare-cli-acceptance-')));
  const executable = resolve(process.env.CROSS_CLI_WORKTREE, 'dist/index.js');
  const command = (args, stdin = '') => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [executable, ...args, '--json', '--storage', 'file', '--auth-directory', directory, '--auth-url', authBaseUrl, '--api-url', apiBaseUrl], {
      env: { PATH: process.env.PATH, RARE_AUTH_DIRECTORY: directory }, timeout: 30000, maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) { reject(new Error('Actual CLI command failed')); return; }
      try {
        const value = JSON.parse(stdout);
        assert.ok(!/"(?:accessToken|refreshToken|deviceCode|access_token|refresh_token|device_code)"/.test(stdout), 'CLI printed secret credential fields');
        resolve(value);
      } catch { reject(new Error('Actual CLI output is not safe JSON')); }
    });
    child.stdin.end(stdin);
  });
  try {
    const pending = await command(['auth', 'login', '--device', '--no-browser', '--no-wait']);
    assert.equal(pending.status, 'pending');
    assert.equal(typeof pending.requestId, 'string');
    const review = await bridge('', { user_code: pending.userCode });
    const challenge = await bridge(`/${review.review_id}/challenge`, { address: wallet.address, chain_id: 1 });
    await bridge(`/${review.review_id}/decision`, {
      decision: 'approve', challenge_id: challenge.challenge_id, message: challenge.message,
      signature: await wallet.signMessage({ message: challenge.message }),
    });
    const login = await command(['auth', 'login', '--resume', pending.requestId]);
    assert.equal(login.status, 'authorized');
    const status = await command(['auth', 'status', '--verify']);
    assert.equal(status.verified, true);
    assert.equal(status.accountId, accountId);
    const profile = await command(['profile', 'get']);
    assert.equal(profile.accountId, accountId);
    const updated = await command(['profile', 'update', '--stdin'], JSON.stringify({ profile: { bio: 'Actual CLI cross-repo acceptance' } }));
    assert.equal(updated.profile.bio, 'Actual CLI cross-repo acceptance');
    const logout = await command(['auth', 'logout']);
    assert.equal(logout.status, 'signed_out');
    assert.equal((await command(['auth', 'status'])).status, 'signed_out');
    console.log('PASS actual CLI device login/resume/status/profile GET/PATCH/logout with isolated file storage');
  } finally {
    try { await command(['auth', 'logout']); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
