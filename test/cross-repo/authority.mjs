// Launch the real built authority with a private disposable Redis process.
// Only for local acceptance; ephemeral RSA keys and cookies intentionally vanish.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const required = name => {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
const loopback = name => {
  const url = new URL(required(name));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a plain loopback HTTP URL`);
  }
  return url.href.replace(/\/$/, '');
};
const random = () => randomBytes(32).toString('hex');
let redisProcess;
let redis;
let server;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (redis?.isOpen) await redis.quit();
  if (redisProcess && redisProcess.exitCode === null) {
    const exited = once(redisProcess, 'exit');
    redisProcess.kill('SIGTERM');
    await exited;
  }
}
async function start() {
  if (required('RARE_CROSS_REPO') !== '1') throw new Error('Set RARE_CROSS_REPO=1 explicitly');
  const root = resolve(required('CROSS_AUTH_WORKTREE'), 'authority');
  const issuer = loopback('CROSS_AUTH_URL');
  const api = loopback('CROSS_API_URL');
  const issuerUrl = new URL(issuer);
  if (issuerUrl.pathname !== '/auth/v2' || !issuerUrl.port) throw new Error('CROSS_AUTH_URL must include an explicit port and /auth/v2');
  const config = {
    issuer, audience: api, provisionUrl: `${api}/internal/v1/accounts/resolve`,
    provisionSecret: required('CROSS_PROVISION_SECRET'),
    introspectionClient: 'rare-api', introspectionSecret: required('CROSS_INTROSPECTION_SECRET'),
    bridgeSecret: required('CROSS_BRIDGE_SECRET'), cookieKeys: [random()],
    redisPrefix: `auth-v2:cross_${random()}:`,
    rpcUrls: { 1: 'http://127.0.0.1:1' }, // EOA signature verification must not require RPC.
    origins: [issuerUrl.origin], connectUrl: `${issuerUrl.origin}/device`,
    internalBaseUrl: issuerUrl.origin, port: Number(issuerUrl.port),
  };
  const credentials = [config.provisionSecret, config.introspectionSecret, config.bridgeSecret];
  if (credentials.some(value => value.length < 32) || new Set(credentials).size !== 3) throw new Error('Distinct test service secrets of at least 32 characters required');
  const requireAuth = createRequire(resolve(root, 'package.json'));
  const { createClient } = requireAuth('redis');
  const { createAuthority } = await import(pathToFileURL(resolve(root, 'dist/authority.mjs')));
  const { createDeviceBridge, deviceBridgeHooks } = await import(pathToFileURL(resolve(root, 'dist/device-bridge.mjs')));
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
  config.jwks = { keys: [{ ...key, kid: random(), alg: 'RS256', use: 'sig' }] };
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  redisProcess = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] });
  redisProcess.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis startup timed out')), 5000);
    redisProcess.once('error', () => { clearTimeout(timer); reject(new Error('Redis binary unavailable')); });
    redisProcess.once('exit', () => { clearTimeout(timer); reject(new Error('Redis stopped before readiness')); });
    let output = '';
    redisProcess.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-8192);
      if (output.includes('Ready to accept connections')) { clearTimeout(timer); resolve(); }
    });
  });
  config.redisUrl = `redis://127.0.0.1:${port}`;
  redis = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } });
  redis.on('error', () => { console.error('FAIL: local Redis connection lost'); process.exitCode = 1; void cleanup(); });
  await redis.connect();
  ({ server } = await createAuthority({ config, redis, deviceHooks: deviceBridgeHooks(config), setupBridge: createDeviceBridge }));
  server.listen(config.port, '127.0.0.1');
  await once(server, 'listening');
  console.log('READY: real authority with disposable Redis; signing keys and sessions are ephemeral');
}
process.once('SIGTERM', () => { void cleanup(); });
process.once('SIGINT', () => { void cleanup(); });
start().catch(async () => {
  console.error('UNAVAILABLE: authority startup failed; check built auth artifacts, loopback URLs, distinct test secrets and redis-server');
  process.exitCode = 2;
  await cleanup();
});
