import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const authRoot = process.env.CROSS_AUTH_WORKTREE;
if (!authRoot) throw new Error("Set CROSS_AUTH_WORKTREE to the Auth checkout");
const monorepo = process.env.CROSS_MONOREPO_WORKTREE;
if (!monorepo)
  throw new Error("Set CROSS_MONOREPO_WORKTREE to the monorepo checkout");
const apiRoot = path.join(monorepo, "services/rare-api");
const auth = createRequire(path.join(authRoot, "package.json"));
const api = createRequire(path.join(apiRoot, "package.json"));
auth("ts-node").register({
  project: path.join(authRoot, "tsconfig.json"),
  transpileOnly: true,
});
const { startTestRedis } = auth("./test/redis.ts");
const { registerV2 } = auth("./build/v2/routes.js");
const { Wallet } = auth("ethers");
const { WALLET_GRANT } = auth("./build/v2/core.js");
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
async function main() {
  const fixture = await startTestRedis();
  const rpc = createServer(() => {}); // Transport fault: deliberately never replies.
  const sockets = new Set();
  rpc.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const rpcUrl = await listen(rpc);
  const server = auth("fastify")();
  const secret = randomBytes(32).toString("hex");
  const store = registerV2(
    server,
    {
      audience: "rare-api",
      internalApiKey: secret,
      origins: ["https://connect.example.test"],
      rpcUrls: { 1: rpcUrl },
      redisPrefix: "auth-v2:capacity:",
      connectUrl: "https://connect.example.test/device",
    },
    fixture.redis,
  );
  await server.ready();
  const authUrl = await listen(server.server);
  api("dotenv").config({
    path: path.join(apiRoot, "../../configs/env.test.tpl"),
  });
  process.env.AUTH_SERVICE = authUrl;
  process.env.AUTH_INTERNAL_API_KEY = secret;
  const { OpenAPIHono } = api("@hono/zod-openapi");
  const { serve } = api("@hono/node-server");
  const { setAuthHandlers } = api("./dist/src/routes/auth/routes.js");
  const app = new OpenAPIHono();
  app.use("*", async (context, next) => {
    context.set("logger", { error() {} });
    await next();
  });
  setAuthHandlers(app);
  const proxy = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await once(proxy, "listening");
  const base = `http://127.0.0.1:${proxy.address().port}/auth/v2`;
  const form = async (target, data, headers = {}) =>
    fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(data),
    });
  try {
    const wallet = Wallet.createRandom();
    const challenge = await fetch(`${base}/wallet/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "rare-sdk",
        address: wallet.address,
        chain_id: 1,
        origin: "https://connect.example.test",
      }),
    }).then((r) => r.json());
    const body = {
      grant_type: WALLET_GRANT,
      client_id: "rare-sdk",
      challenge_id: challenge.challenge_id,
      message: challenge.message,
      signature: `0x${"ab".repeat(16384)}`,
    };
    const bytes = Buffer.byteLength(new URLSearchParams(body).toString());
    assert(bytes > 24576 && bytes < 49152);
    const started = Date.now();
    const failed = await form(`${base}/token`, body);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).error, "temporarily_unavailable");
    const elapsed = Date.now() - started;
    assert(elapsed >= 4900 && elapsed < 9000);
    assert.equal(
      (await form(`${base}/token`, { oversized: "a".repeat(49153) })).status,
      413,
    );
    assert.equal(
      (await form(`${base}/introspect`, { token: "fake" })).status,
      404,
    );
    console.log(
      JSON.stringify({
        publicPathRequestBytes: bytes,
        stalledRpcMilliseconds: elapsed,
        status: 503,
        oversizeStatus: 413,
      }),
    );
    const tokenBody = {
      ...body,
      signature: await wallet.signMessage(challenge.message),
    };
    const login = await form(`${base}/token`, tokenBody);
    assert.equal(login.status, 200);
    const initial = await login.json();
    assert.equal(initial.expires_in, 300);
    const tokens = [initial];
    for (const count of Array.from({ length: 100 }, (_, index) => index)) {
      const result = await form(`${base}/token`, {
        grant_type: "refresh_token",
        client_id: "rare-sdk",
        refresh_token: tokens[count].refresh_token,
      });
      assert.equal(result.status, 200);
      tokens.push(await result.json());
    }
    const keys = tokens.map((token) =>
      store.key("refresh", token.refresh_token),
    );
    const memories = await Promise.all(
      keys.map((key) => fixture.client.sendCommand(["MEMORY", "USAGE", key])),
    );
    const average =
      memories.reduce((sum, value) => sum + value, 0) / keys.length;
    const ttl = await fixture.client.ttl(keys[0]);
    assert(ttl > 31535000);
    const rateKey = store.key("rate", "introspection:127.0.0.1");
    await fixture.client.set(rateKey, "240", { EX: 60 });
    assert.equal(
      (
        await form(`${authUrl}/auth/v2/introspect`, {
          token: tokens.at(-1).access_token,
        })
      ).status,
      429,
    );
    const valid = await form(
      `${authUrl}/auth/v2/introspect`,
      { token: tokens.at(-1).access_token },
      { authorization: `Bearer ${secret}` },
    );
    assert.equal((await valid.json()).active, true);
    assert.equal(
      (
        await form(
          `${authUrl}/auth/v2/introspect`,
          { token: "fake" },
          { authorization: "Bearer wrong" },
        )
      ).status,
      429,
    );
    await fixture.client.del(rateKey);
    await form(`${base}/revoke`, {
      client_id: "rare-sdk",
      token: tokens.at(-1).refresh_token,
    });
    assert.equal(
      (
        await form(`${authUrl}/auth/v2/introspect`, {
          token: tokens.at(-1).access_token,
        }).then((r) => r.json())
      ).active,
      false,
    );
    console.log(
      JSON.stringify({
        refreshRecords: keys.length,
        averageRecordBytes: average,
        oldestRecordTtlSeconds: ttl,
        yearAtFiveMinuteRotationMiB: (average * 105120) / 1048576,
        accessLifetimeSeconds: initial.expires_in,
      }),
    );
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
    server.server.closeAllConnections();
    await server.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => rpc.close(resolve));
    await fixture.close();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
