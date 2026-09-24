// Compose the real authority and Rare API around an already running backend-owned
// GraphQL harness/Postgres/PubSub emulator. No service response is substituted.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const sdkRoot = fileURLToPath(new URL('../../', import.meta.url));
const children = [];
let temp;
const required = key => { if (!process.env[key]) throw new Error(`Missing ${key}`); return process.env[key]; };
async function main() {
  if (required('RARE_CROSS_REPO') !== '1') throw new Error('Explicit opt-in required');
  const monorepo = resolve(required('CROSS_MONOREPO_WORKTREE'));
  const backendEnvFile = resolve(required('CROSS_BACKEND_ENV_FILE'));
  const backendEnv = await readFile(backendEnvFile, 'utf8');
  const gqlUrl = /^GQL_API_URL=(.+)$/m.exec(backendEnv)?.[1];
  if (!gqlUrl || !['127.0.0.1', 'localhost'].includes(new URL(gqlUrl).hostname)) throw new Error('Backend harness must be loopback');
  const apiUrl = new URL(required('CROSS_API_URL'));
  if (!['127.0.0.1', 'localhost'].includes(apiUrl.hostname) || !apiUrl.port) throw new Error('API must be loopback with explicit port');
  temp = await mkdtemp(join(tmpdir(), 'rare-cross-'));
  const secret = () => randomBytes(32).toString('hex');
  const env = { ...process.env, CROSS_PROVISION_SECRET: secret(), CROSS_INTROSPECTION_SECRET: secret(), CROSS_BRIDGE_SECRET: secret() };
  const authFile = join(temp, 'authority.env');
  await writeFile(authFile, [
    `ACCOUNT_PROVISIONING_SECRET=${env.CROSS_PROVISION_SECRET}`,
    `AUTH_PUBLIC_URL=${new URL(required('CROSS_AUTH_URL')).origin}`,
    `AUTH_INTROSPECTION_SECRET=${env.CROSS_INTROSPECTION_SECRET}`,
    `PORT=${apiUrl.port}`, '',
  ].join('\n'), { mode: 0o600 });
  const launch = (command, args, cwd, visible = false) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.on('error', () => {});
    // Never print backend logs: HTTP diagnostics may contain credential headers.
    child.stdout.on('data', data => { if (visible) process.stdout.write(data); });
    child.stderr.on('data', data => { if (visible) process.stderr.write(data); });
    return child;
  };
  launch(process.execPath, ['test/cross-repo/authority.mjs'], sdkRoot);
  launch(process.env.PNPM_BIN || 'pnpm', ['--filter', '@rarest/gql-api', 'exec', 'dotenv', '-e', '../../configs/env.test.tpl', '-e', backendEnvFile, '-e', authFile, '-o', '--', 'pnpm', '--dir', '../rare-api', 'exec', 'tsx', 'src/main.ts'], monorepo);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error('A local service exited before readiness');
    try {
      const auth = await fetch(`${env.CROSS_AUTH_URL}/introspect`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=untrusted', signal: AbortSignal.timeout(1000) });
      const api = await fetch(`${env.CROSS_API_URL}/v1/me`, { signal: AbortSignal.timeout(1000) });
      if (auth.status === 401 && api.status === 401) { ready = true; break; }
    } catch { /* Services may still be compiling/starting. */ }
    await sleep(500);
  }
  if (!ready) throw new Error('Actual authority/API not ready');
  const runner = launch(process.execPath, ['test/cross-repo/run.mjs'], sdkRoot, true);
  const code = await new Promise(resolve => runner.once('exit', resolve));
  process.exitCode = code ?? 1;
}
try { await main(); }
catch {
  console.error('UNAVAILABLE: local stack startup failed; check backend harness, compiled artifacts and explicit environment');
  process.exitCode = 2;
} finally {
  for (const child of children.reverse()) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already gone. */ } }
  }
  await sleep(500);
  for (const child of children) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ } }
  }
  if (temp) await rm(temp, { recursive: true, force: true });
}
