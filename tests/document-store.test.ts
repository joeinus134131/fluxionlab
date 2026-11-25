import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { enterTemporaryDirectory } from "./helpers";

const directory = enterTemporaryDirectory();
const { createDocumentStore, DocumentError, HISTORY_LIMIT } = await import("@/lib/document-store");

const schema = z.object({ n: z.number().max(1000) });
const make = (name: string) => createDocumentStore({ name, key: "value", schema, empty: { n: 0 } });
/** Meniru restart server. */
const restart = () => (globalThis as { __fluxionDocuments?: Map<string, unknown> }).__fluxionDocuments?.clear();
const file = (name: string) => path.join(directory, ".data", name);

test("commit, urungkan, dan ulangi", () => {
  const store = make("a");
  store.commit(() => ({ n: 1 }));
  store.commit(() => ({ n: 2 }));
  assert.equal(store.undo().value.n, 1);
  assert.equal(store.redo().value.n, 2);
  assert.throws(() => store.redo(), DocumentError);
  store.undo();
  store.commit(() => ({ n: 9 }));
  assert.throws(() => store.redo(), DocumentError, "perubahan baru menghapus daftar ulangi");
});

test("dokumen dan riwayat bertahan setelah restart", () => {
  const store = make("b");
  store.commit(() => ({ n: 1 }));
  store.commit(() => ({ n: 2 }));
  restart();
  assert.deepEqual(store.get(), { version: 2, value: { n: 2 } });
  assert.equal(store.undo().value.n, 1);
});

test("perubahan tidak valid ditolak tanpa mengubah apa pun", () => {
  const store = make("c");
  store.commit(() => ({ n: 5 }));
  assert.throws(() => store.commit(() => ({ n: 5000 })), DocumentError);
  assert.deepEqual(store.get(), { version: 1, value: { n: 5 } });
});

test("riwayat dibatasi", () => {
  const store = make("d");
  for (let n = 1; n <= HISTORY_LIMIT + 5; n++) store.commit(() => ({ n }));
  for (let i = 0; i < HISTORY_LIMIT; i++) store.undo();
  assert.throws(() => store.undo(), DocumentError);
});

test("perubahan file dari proses lain terbaca", () => {
  const store = make("e");
  store.commit(() => ({ n: 1 }));
  writeFileSync(file("e.json"), JSON.stringify({ version: 7, value: { n: 70 } }));
  assert.deepEqual(store.get(), { version: 7, value: { n: 70 } });
  assert.throws(() => store.undo(), DocumentError, "riwayat lama tidak dipakai untuk isi yang berbeda");
});

test("file rusak dipindahkan, bukan ditimpa", () => {
  mkdirSync(file(""), { recursive: true });
  writeFileSync(file("f.json"), "{rusak");
  assert.deepEqual(make("f").get(), { version: 0, value: { n: 0 } });
  const moved = readdirSync(file("")).find((name) => name.startsWith("f.json.rusak-"));
  assert.ok(moved);
  assert.equal(readFileSync(file(moved), "utf8"), "{rusak");
});

test("file data hanya bisa dibaca pemiliknya", { skip: process.platform === "win32" }, () => {
  make("g").commit(() => ({ n: 1 }));
  assert.equal(statSync(file("g.json")).mode & 0o777, 0o600);
  assert.ok(!readdirSync(file("")).some((name) => name.endsWith(".tmp")));
});

test("scene format lama tetap bisa dibuka", async () => {
  const object = {
    id: "abc",
    name: "Kubus",
    type: "box",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    metalness: 0,
    roughness: 1,
  };
  writeFileSync(file("scene.json"), JSON.stringify({ version: 4, scene: { name: "Lama", objects: [object] } }));
  const { getState, applyOperation } = await import("@/lib/scene-store");
  assert.equal(getState().version, 4);
  assert.equal(getState().scene.objects[0].id, "abc");
  assert.equal(applyOperation({ op: "remove", ids: ["abc"] }).scene.objects.length, 0);
  assert.equal(applyOperation({ op: "undo" }).scene.objects.length, 1);
  assert.equal(applyOperation({ op: "redo" }).scene.objects.length, 0);
});
