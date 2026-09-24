// Launch the actual shared auth service with private disposable Redis.
// Legacy and v2 routes use the same Fastify listener; no separate authority package.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

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
let app;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (app) await app.close();
  if (redis?.isOpen) await redis.quit();
  if (redisProcess && redisProcess.exitCode === null) {
    const exited = once(redisProcess, 'exit');
    redisProcess.kill('SIGTERM');
    await exited;
  }
}
async function start() {
  if (required('RARE_CROSS_REPO') !== '1') throw new Error('Set RARE_CROSS_REPO=1 explicitly');
  const root = resolve(required('CROSS_AUTH_WORKTREE'));
  const issuer = loopback('CROSS_AUTH_URL');
  const api = loopback('CROSS_API_URL');
  const issuerUrl = new URL(issuer);
  if (issuerUrl.pathname !== '/auth/v2' || !issuerUrl.port) throw new Error('CROSS_AUTH_URL must include an explicit port and /auth/v2');
  const internalApiKey = required('CROSS_AUTH_INTERNAL_API_KEY');
  if (internalApiKey.length < 32) throw new Error('Test internal API key must be at least 32 characters');
  Object.assign(process.env, {
    JWT_SECRET: random(), AUTH_PUBLIC_URL: issuerUrl.origin,
    RARE_API_URL: api, CONNECT_URL: issuerUrl.origin,
    AUTH_INTERNAL_API_KEY: internalApiKey,
    SIWE_ALLOWED_ORIGINS: issuerUrl.origin, SIWE_ALLOWED_CHAIN_IDS: '1', ETH_MAINNET_NODE_URL: 'http://127.0.0.1:1',
  });
  const requireAuth = createRequire(resolve(root, 'package.json'));
  const { createClient } = requireAuth('redis');
  const { Server } = requireAuth('./build/server/impl/Server.js');
  const { SessionDAO } = requireAuth('./build/dao/impl/SessionDAO.js');
  const { RedisDatabase } = requireAuth('./build/db/impl/RedisDatabase.js');
  const { AuthChallengeDAO } = requireAuth('./build/dao/impl/AuthChallengeDAO.js');
  const { SiweChallengeService } = requireAuth('./build/siwe/SiweChallengeService.js');
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
  redis = createClient({ url: `redis://127.0.0.1:${port}`, socket: { reconnectStrategy: false } });
  redis.on('error', () => { console.error('FAIL: local Redis connection lost'); process.exitCode = 1; void cleanup(); });
  await redis.connect();
  const connection = {
    setupDB: async () => {},
    get: key => redis.get(key),
    set: (key, value, options) => redis.set(key, value, options),
    eval: (script, keys, args) => redis.eval(script, { keys, arguments: args }),
  };
  const hosted = new Server(new SessionDAO(new RedisDatabase(connection)), new SiweChallengeService(new AuthChallengeDAO(connection)), connection);
  app = hosted.server;
  await hosted.start(Number(issuerUrl.port), '127.0.0.1');
  console.log('READY: shared legacy/v2 auth service with disposable Redis');
}
process.once('SIGTERM', () => { void cleanup(); });
process.once('SIGINT', () => { void cleanup(); });
start().catch(async () => {
  console.error('UNAVAILABLE: authority startup failed; check built auth artifacts, loopback URLs, test internal API key and redis-server');
  process.exitCode = 2;
  await cleanup();
});
