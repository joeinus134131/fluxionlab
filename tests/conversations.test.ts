import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ConversationView } from "@/lib/conversations";
import { blinker, enterTemporaryDirectory } from "./helpers";

enterTemporaryDirectory();
delete process.env.FLUXION_API_TOKEN;

const conversationRoute = await import("@/app/api/conversations/route");
const aiRoute = await import("@/app/api/ai/route");
const pcbAiRoute = await import("@/app/api/pcb/ai/route");
const settingsRoute = await import("@/app/api/settings/route");
const { applyOperation, getState } = await import("@/lib/scene-store");
const { getBoardState } = await import("@/lib/pcb-store");

type Message = { role: string; content: unknown };
let replies: { content: string; delay?: number }[] = [];
let received: Message[][] = [];

const provider = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push(JSON.parse(body).messages);
    const reply = replies.shift();
    setTimeout(() => {
      response.writeHead(reply ? 200 : 500, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: reply?.content } }] }));
    }, reply?.delay ?? 0);
  });
});

function call(handler: (request: Request) => Promise<Response>, body?: unknown, query = "", host = "localhost:3000") {
  return handler(
    new Request(`http://localhost:3000/api${query}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { host, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

let model = "";
before(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  const response = await call(settingsRoute.POST, {
    op: "saveConnection",
    connection: { name: "tiruan", baseUrl, model: "mock", apiKey: "sk-uji-1234" },
  });
  model = (await response.json()).connections[0].id;
});
after(() => {
  provider.closeAllConnections();
  provider.close();
});

const list = async (kind: string): Promise<ConversationView> =>
  (await call(conversationRoute.GET, undefined, `?kind=${kind}`)).json();
const change = async (body: object) => {
  const response = await call(conversationRoute.POST, body);
  return { status: response.status, data: await response.json() };
};
const sceneReply = (name: string) => ({
  content: JSON.stringify({
    name,
    objects: [
      { name, type: "box", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#ffffff", metalness: 0, roughness: 1 },
    ],
  }),
});
const ask = (prompt: string, extra: object = {}) =>
  call(aiRoute.POST, { prompt, provider: "compatible", model, ...extra });

test("tiap percakapan menyimpan desain dan riwayatnya sendiri", async () => {
  // Desain yang sudah ada menjadi milik percakapan pertama.
  applyOperation({ op: "replace", scene: JSON.parse(sceneReply("Lama").content) });
  const first = await list("scene");
  const oldId = getState().scene.objects[0].id;
  assert.equal(first.items.length, 1);

  const image = { kind: "text", name: "ukuran.txt", data: "lebar 40 mm" };
  replies = [sceneReply("Rumah")];
  assert.equal((await ask("buat rumah", { attachments: [image] })).status, 200);
  const houseId = getState().scene.objects[0].id;

  const created = await change({ op: "new", kind: "scene" });
  assert.equal(created.status, 200);
  assert.equal(created.data.state.scene.objects.length, 0);
  assert.equal(created.data.messages.length, 0);
  assert.notEqual(created.data.activeId, first.activeId);

  received = [];
  replies = [sceneReply("Robot")];
  assert.equal((await ask("buat robot")).status, 200);
  assert.equal(received[0].length, 2, "topik baru tidak membawa riwayat topik lain");
  assert.ok(!JSON.stringify(received[0]).includes("rumah"));

  const back = await change({ op: "select", kind: "scene", id: first.activeId });
  assert.equal(back.data.state.scene.name, "Rumah");
  assert.equal(back.data.state.scene.objects[0].id, houseId, "id objek tidak berubah saat pindah");
  assert.notEqual(houseId, oldId);
  assert.equal(back.data.items.find((i: { id: string }) => i.id === first.activeId).title, "buat rumah");

  // Urungkan tidak boleh menarik desain dari percakapan lain.
  assert.throws(() => applyOperation({ op: "undo" }), /bisa diurungkan/);
  assert.equal(getState().scene.name, "Rumah");

  received = [];
  replies = [sceneReply("Rumah 2")];
  assert.equal((await ask("tambah pagar")).status, 200);
  assert.deepEqual(received[0].map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.match(JSON.stringify(received[0][1].content), /buat rumah/);
  assert.match(JSON.stringify(received[0][1].content), /lebar 40 mm/, "lampiran lama ikut dikirim");
});

test("ganti nama, hapus, dan penolakan input", async () => {
  const before = await list("scene");
  const renamed = await change({ op: "rename", kind: "scene", id: before.activeId, title: "  Proyek rumah " });
  assert.equal(renamed.data.items.find((i: { id: string }) => i.id === before.activeId).title, "Proyek rumah");
  assert.equal((await change({ op: "select", kind: "scene", id: "tidak-ada" })).status, 400);
  assert.equal((await change({ op: "rename", kind: "scene", id: before.activeId, title: " " })).status, 400);
  assert.equal((await ask("uji", { conversationId: "tidak-ada" })).status, 409);

  assert.ok(existsSync(`.data/attachments/${before.activeId}`));
  const removed = await change({ op: "delete", kind: "scene", id: before.activeId });
  assert.equal(removed.data.state.scene.name, "Robot");
  assert.ok(!existsSync(`.data/attachments/${before.activeId}`), "lampiran ikut terhapus");

  // Menghapus yang terakhir menyisakan satu percakapan kosong.
  const last = await change({ op: "delete", kind: "scene", id: removed.data.activeId });
  assert.equal(last.data.items.length, 1);
  assert.equal(last.data.state.scene.objects.length, 0);

  // Percakapan kosong dipakai ulang, bukan menambah entri.
  assert.equal((await change({ op: "new", kind: "scene" })).data.items.length, 1);
});

test("ganti percakapan saat AI bekerja: hasil tidak diterapkan dan tidak dicatat", async () => {
  replies = [sceneReply("A")];
  await ask("buat A");
  replies = [{ ...sceneReply("Terlambat"), delay: 300 }];
  const pending = ask("lambat");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const created = await change({ op: "new", kind: "scene" });
  assert.equal((await pending).status, 409);
  assert.equal(getState().scene.objects.length, 0);
  assert.equal((await list("scene")).messages.length, 0);
  const old = await change({ op: "select", kind: "scene", id: created.data.items.find((i: { count: number }) => i.count > 0).id });
  assert.equal(old.data.messages.length, 2);
});

test("PCB punya daftar sendiri dan review masuk riwayat", async () => {
  const body = { provider: "compatible", model };
  replies = [{ content: JSON.stringify(blinker) }, { content: "Hasil review." }];
  assert.equal((await call(pcbAiRoute.POST, { ...body, mode: "design", prompt: "blinker" })).status, 200);
  assert.equal((await call(pcbAiRoute.POST, { ...body, mode: "review" })).status, 200);
  const view = await list("pcb");
  assert.deepEqual(view.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(view.messages[3].text, "Hasil review.");
  assert.ok(!(await list("scene")).messages.some((m) => m.text === "blinker"));
  const created = await change({ op: "new", kind: "pcb" });
  assert.equal(getBoardState().board.components.length, 0);
  await change({ op: "select", kind: "pcb", id: view.activeId });
  assert.equal(getBoardState().board.components.length, blinker.components.length);
  assert.notEqual(created.data.activeId, view.activeId);
});

test("API percakapan hanya dari komputer ini dan file rusak tidak ditimpa", async () => {
  process.env.FLUXION_API_TOKEN = "token-uji";
  const outside = await conversationRoute.GET(
    new Request("http://localhost:3000/api?kind=scene", {
      headers: { host: "evil.test", authorization: "Bearer token-uji" },
    }),
  );
  assert.equal(outside.status, 403);
  delete process.env.FLUXION_API_TOKEN;
  assert.equal((await call(conversationRoute.GET, undefined, "?kind=lain")).status, 400);

  writeFileSync(".data/conversations-pcb.json", "{rusak");
  assert.equal((await list("pcb")).items.length, 1);
  assert.ok(readdirSync(".data").some((file) => file.startsWith("conversations-pcb.json.rusak-")));
});
