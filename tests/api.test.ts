import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { blinker } from "./helpers";
import { enterTemporaryDirectory } from "./helpers";

enterTemporaryDirectory();
process.env.FLUXION_AI_TIMEOUT_MS = "1500";
delete process.env.FLUXION_API_TOKEN;

const sceneRoute = await import("@/app/api/scene/route");
const pcbRoute = await import("@/app/api/pcb/route");
const pcbAiRoute = await import("@/app/api/pcb/ai/route");
const aiRoute = await import("@/app/api/ai/route");
const settingsRoute = await import("@/app/api/settings/route");
const mcpRoute = await import("@/app/api/mcp/route");

const KEY = "sk-rahasia-1234567890abcdef";
type Reply = { status?: number; body?: string; content?: string; delay?: number; location?: string };
let replies: Reply[] = [];
let received: { url: string; authorization?: string; body: string }[] = [];

const provider = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push({ url: request.url!, authorization: request.headers.authorization, body });
    const reply = replies.shift() ?? { status: 500, body: "tidak ada balasan" };
    setTimeout(() => {
      if (reply.location) response.writeHead(307, { location: reply.location });
      else response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      response.end(reply.body ?? JSON.stringify({ choices: [{ message: { content: reply.content } }] }));
    }, reply.delay ?? 0);
  });
});

let connection = "";

function call(
  handler: (request: Request) => Promise<Response>,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return handler(
    new Request("http://localhost:3000/api", {
      method: body === undefined ? "GET" : "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

before(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  const response = await call(settingsRoute.POST, {
    op: "saveConnection",
    connection: { name: "tiruan", baseUrl, model: "mock", apiKey: KEY },
  });
  connection = (await response.json()).connections[0].id;
});
after(() => {
  provider.closeAllConnections();
  provider.close();
});
beforeEach(() => {
  replies = [];
  received = [];
});

const design = (extra: object = {}) => ({
  mode: "design",
  prompt: "uji",
  provider: "compatible",
  model: connection,
  ...extra,
});
const json = (value: unknown) => ({ content: JSON.stringify(value) });
const colliding = {
  ...blinker,
  components: blinker.components.map((c) => (c.ref === "C2" ? { ...c, x: 16, y: 9 } : c)),
};

test("permintaan lintas situs dan host asing ditolak di semua API", async () => {
  for (const handler of [sceneRoute.POST, pcbRoute.POST, aiRoute.POST, pcbAiRoute.POST, settingsRoute.POST, mcpRoute.POST]) {
    assert.equal((await call(handler, {}, { origin: "http://evil.test" })).status, 403);
    assert.equal((await call(handler, {}, { host: "evil.test" })).status, 403);
    assert.equal((await call(handler, {}, { "sec-fetch-site": "cross-site" })).status, 403);
  }
});

test("token API tidak berlaku untuk pengaturan", async () => {
  process.env.FLUXION_API_TOKEN = "token-uji";
  const headers = { host: "evil.test", authorization: "Bearer token-uji" };
  assert.equal((await call(sceneRoute.GET, undefined, headers)).status, 200);
  assert.equal((await call(settingsRoute.GET, undefined, headers)).status, 403);
  delete process.env.FLUXION_API_TOKEN;
});

test("input buruk dibalas dengan status yang tepat", async () => {
  assert.equal((await call(sceneRoute.POST, "{rusak")).status, 400);
  assert.equal((await call(sceneRoute.POST, {}, { "content-type": "text/plain" })).status, 415);
  assert.equal((await call(sceneRoute.POST, "x".repeat(3 * 1024 * 1024))).status, 413);
  assert.equal((await call(mcpRoute.POST, "x".repeat(3 * 1024 * 1024))).status, 413);
  const invalid = await call(settingsRoute.POST, { op: "setClaudeKey", apiKey: `${KEY} spasi` });
  assert.equal(invalid.status, 400);
  assert.ok(!(await invalid.text()).includes(KEY), "nilai kiriman tidak boleh dipantulkan");
  assert.equal((await call(pcbRoute.POST, { op: "move", ref: "ZZ9", x: 1, y: 1, rotation: 0 })).status, 400);
});

test("pengaturan tidak pernah mengirim balik API key", async () => {
  const text = await (await call(settingsRoute.GET)).text();
  assert.ok(!text.includes(KEY));
  assert.match(text, /…cdef/);
});

test("PCB: hasil bersih hanya memakai satu panggilan", async () => {
  replies = [json(blinker)];
  const response = await call(pcbAiRoute.POST, design());
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  assert.deepEqual([data.calls, data.problems, received.length], [1, 0, 1]);
  assert.equal(received[0].authorization, `Bearer ${KEY}`);
});

test("PCB: hasil gagal cek diperbaiki sekali", async () => {
  replies = [json(colliding), json(blinker)];
  const data = await (await call(pcbAiRoute.POST, design())).json();
  assert.deepEqual([data.calls, data.problems, received.length], [2, 0, 2]);
  assert.match(received[1].body, /bertabrakan/);
});

test("PCB: perbaikan otomatis bisa dimatikan", async () => {
  replies = [json(colliding)];
  const data = await (await call(pcbAiRoute.POST, design({ autoRepair: false }))).json();
  assert.equal(received.length, 1);
  assert.ok(data.problems > 0);
});

test("PCB: perbaikan yang gagal atau membuang komponen diabaikan", async () => {
  replies = [json(colliding), { status: 503, body: "sibuk" }];
  let data = await (await call(pcbAiRoute.POST, design())).json();
  assert.equal(data.board.components.length, colliding.components.length);
  replies = [json(colliding), json({ ...blinker, components: [], nets: [] })];
  data = await (await call(pcbAiRoute.POST, design())).json();
  assert.equal(data.board.components.length, colliding.components.length);
});

test("balasan tidak valid diberi satu kesempatan, tidak lebih", async () => {
  replies = [{ content: "bukan json" }, json(blinker)];
  assert.equal((await call(pcbAiRoute.POST, design())).status, 200);
  assert.equal(received.length, 2);

  received = [];
  replies = [{ content: "bukan json" }, { content: "masih bukan" }, json(blinker)];
  assert.equal((await call(pcbAiRoute.POST, design())).status, 502);
  assert.equal(received.length, 2);
});

test("3D: scene dari model diterapkan", async () => {
  replies = [json({ name: "Uji", objects: [] })];
  const response = await call(aiRoute.POST, { prompt: "uji", provider: "compatible", model: connection });
  assert.equal((await response.json()).scene.name, "Uji");
});

test("API key disensor dari pesan galat penyedia", async () => {
  replies = [{ status: 401, body: `kunci salah: ${KEY}` }];
  const response = await call(pcbAiRoute.POST, design());
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.ok(!text.includes(KEY));
  assert.match(text, /kunci disembunyikan/);
});

test("pengalihan dari penyedia tidak diikuti", async () => {
  replies = [{ location: "/pindah", body: "" }, json(blinker)];
  assert.equal((await call(pcbAiRoute.POST, design())).status, 502);
  assert.equal(received.length, 1);
});

test("model yang terlalu lama dihentikan dengan pesan jelas", async () => {
  replies = [{ ...json(blinker), delay: 4000 }];
  const response = await call(pcbAiRoute.POST, design());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /terlalu lama/);
});

test("permintaan AI paralel dibatasi", async () => {
  replies = [1, 2, 3].map(() => ({ ...json(blinker), delay: 300 }));
  const statuses = await Promise.all(
    [1, 2, 3].map(async () => (await call(pcbAiRoute.POST, design())).status),
  );
  assert.equal(statuses.filter((s) => s === 429).length, 1);
  assert.equal(received.length, 2);
});

test("hasil AI tidak menimpa perubahan yang masuk saat model bekerja", async () => {
  replies = [{ ...json(blinker), delay: 400 }];
  const pending = call(pcbAiRoute.POST, design());
  await new Promise((resolve) => setTimeout(resolve, 100));
  await call(pcbRoute.POST, { op: "rules", rules: { name: "Diubah pengguna" } });
  assert.equal((await pending).status, 409);
  assert.equal((await (await call(pcbRoute.GET)).json()).board.name, "Diubah pengguna");
});

test("MCP: daftar tool dan perubahan PCB lengkap dengan hasil cek", async () => {
  const rpc = async (method: string, params?: object) => {
    const response = await call(
      mcpRoute.POST,
      { jsonrpc: "2.0", id: 1, method, params },
      { accept: "application/json, text/event-stream" },
    );
    return (await response.json()).result;
  };
  const names = (await rpc("tools/list")).tools.map((t: { name: string }) => t.name);
  for (const name of ["get_scene", "redo", "set_board", "move_component", "redo_board"]) assert.ok(names.includes(name), name);
  const result = await rpc("tools/call", { name: "set_board", arguments: colliding });
  assert.match(result.content[0].text, /bertabrakan/);
});
