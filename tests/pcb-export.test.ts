import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { courtyard, placedPads } from "@/lib/pcb";
import { productionFiles, zip } from "@/lib/pcb-export";
import { routeBoard } from "@/lib/pcb-router";
import { silkscreen, textStrokes } from "@/lib/pcb-silk";
import { blinker, part } from "./helpers";

const routing = routeBoard(blinker);
const files = productionFiles(blinker, routing);

test("paket produksi lengkap", () => {
  assert.deepEqual(Object.keys(files).sort(), [
    "BACA-SAYA.txt",
    "bom.csv",
    "bottom-copper.gbl",
    "bottom-mask.gbs",
    "drill-npth.drl",
    "drill-pth.drl",
    "outline.gko",
    "posisi-komponen.csv",
    "top-copper.gtl",
    "top-mask.gts",
    "top-silk.gto",
  ]);
});

test("setiap Gerber: aperture didefinisikan, koordinat di dalam papan, dan ditutup", () => {
  for (const [name, text] of Object.entries(files)) {
    if (!/\.g(tl|bl|ts|bs|to|ko)$/.test(name)) continue;
    assert.match(text, /%FSLAX46Y46\*%\n%MOMM\*%/, name);
    assert.ok(text.trimEnd().endsWith("M02*"), name);
    const defined = new Set([...text.matchAll(/%ADD(\d+)[CR],/g)].map((m) => m[1]));
    let selected = false;
    let operations = 0;
    for (const line of text.split("\n")) {
      const select = /^D(\d+)\*$/.exec(line);
      if (select) {
        assert.ok(defined.has(select[1]), `${name}: D${select[1]}`);
        selected = true;
      }
      const move = /^X(-?\d+)Y(-?\d+)D0[123]\*$/.exec(line);
      if (!move) continue;
      operations++;
      assert.ok(selected, `${name}: gambar sebelum aperture dipilih`);
      const [x, y] = [Number(move[1]) / 1e6, Number(move[2]) / 1e6];
      assert.ok(x >= 0 && x <= blinker.width && y >= 0 && y <= blinker.height, `${name}: ${x},${y}`);
    }
    assert.ok(operations > 0, name);
  }
});

test("lebar jalur dan sumbu Y benar di tembaga", () => {
  assert.match(files["top-copper.gtl"] + files["bottom-copper.gbl"], /C,0\.6000\*%/);
  // J1.1 ada di (5, 18.73) pada tampilan; Gerber membalik Y menjadi 40 - 18.73.
  assert.match(files["top-copper.gtl"], /X5000000Y21270000D03\*/);
});

test("jumlah lubang bor sesuai pad dan via", () => {
  const holes = (name: string) => files[name].split("\n").filter((line) => /^X[\d.]+Y[\d.]+$/.test(line)).length;
  const pads = blinker.components.flatMap(placedPads);
  assert.equal(holes("drill-pth.drl"), pads.filter((p) => p.drill > 0 && p.plated).length + routing.vias.length);
  assert.equal(holes("drill-npth.drl"), 1);
});

test("CSV menetralkan rumus spreadsheet", () => {
  const board = { ...blinker, components: [{ ...part("R1", "0805", 10, 10), value: '=HYPERLINK("x"),1' }] };
  assert.match(productionFiles(board, routing)["bom.csv"], /"'=HYPERLINK\(""x""\),1"/);
});

test("ZIP dapat dibaca dan CRC-nya benar", () => {
  const archive = Buffer.from(zip(files));
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), Object.keys(files).length);
  let at = archive.readUInt32LE(end + 16);
  for (const [name, text] of Object.entries(files)) {
    const nameLength = archive.readUInt16LE(at + 28);
    assert.equal(archive.toString("utf8", at + 46, at + 46 + nameLength), name);
    const size = archive.readUInt32LE(at + 24);
    const local = archive.readUInt32LE(at + 42);
    const start = local + 30 + archive.readUInt16LE(local + 26);
    const data = archive.subarray(start, start + size);
    assert.equal(data.toString("utf8"), text);
    assert.equal(archive.readUInt32LE(at + 16), crc32(data));
    at += 46 + nameLength;
  }
});

test("silkscreen punya huruf, penanda pin 1, dan tidak menimpa pad", () => {
  for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
    assert.ok(textStrokes(char, 0, 0).length > 0, char);
  }
  const silk = silkscreen(blinker);
  const pads = blinker.components.flatMap(placedPads);
  assert.equal(silk.filter((s) => s.texts.length === 0).length, 0);
  assert.equal(silk.filter((s) => s.pin1 === null).length, 1, "hanya lubang baut tanpa pin 1");
  const points = silk.flatMap((s) => [...s.texts.flat(), ...(s.pin1 ? [s.pin1] : [])]);
  for (const point of points) {
    const hit = pads.find(
      (p) => Math.abs(point.x - p.x) < p.w / 2 && Math.abs(point.y - p.y) < p.h / 2,
    );
    assert.equal(hit, undefined);
  }
  assert.equal(silk.length, blinker.components.map(courtyard).length);
});
