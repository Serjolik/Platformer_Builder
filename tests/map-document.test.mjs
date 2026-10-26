import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Transpile without generating repository files; supported by the project's Node 22 baseline.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const modelUrl = moduleUrl(await readFile(new URL("../app/world-model.ts", import.meta.url), "utf8"));
const blockingUrl = moduleUrl(await readFile(new URL("../app/blocking-model.ts", import.meta.url), "utf8"));
const transitionsUrl = moduleUrl(await readFile(new URL("../app/room-transitions.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../app/map-document.ts", import.meta.url), "utf8"))
  .replace('"./world-model"', JSON.stringify(modelUrl)).replace('"./blocking-model"', JSON.stringify(blockingUrl))
  .replace('"./room-transitions"', JSON.stringify(transitionsUrl));
const { normalizeDocument, getMovingPlatformLayout } = await import(moduleUrl(source));

const legacy = () => ({
  version: 1, name: "Старый проект", grid: 32, inactiveLayerOpacity: .32,
  layers: [{ id: "layer-gameplay", name: "Геймплей", visible: true, locked: false }],
  items: [
    { id: "old-room", kind: "room", label: "Зал", x: -96, y: 32, w: 8, h: 5, color: "#8fa4b8", layerId: "layer-gameplay", polygonPoints: [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 160 }, { x: 0, y: 160 }], sideTypes: ["door", "straight", "opening", "breakable"] },
    { id: "old-platform", kind: "platform", label: "Пол", x: -64, y: 128, w: 5, h: 1, color: "#53c7be", layerId: "layer-gameplay", attachedRoomId: "old-room" },
    { id: "loose-note", kind: "note", label: "Не привязано", x: 400, y: 0, w: 3, h: 2, color: "#ffffff", layerId: "layer-gameplay" },
  ],
  paths: [{ id: "drawn-arrow", kind: "arrow", from: { x: -20, y: 10 }, to: { x: 600, y: 100 }, control: { x: 300, y: -10 }, color: "#ffcc44", layerId: "layer-gameplay" }],
});

test("legacy migration preserves geometry, attachments, layers and loose objects exactly", () => {
  const input = legacy();
  const before = structuredClone(input);
  const result = normalizeDocument(input);
  assert.equal(result.version, 2);
  assert.deepEqual(input, before);
  for (const field of ["items", "paths", "layers", "name", "grid", "inactiveLayerOpacity"]) assert.deepEqual(result[field], input[field]);
  assert.equal(result.world.rooms.length, 1);
  assert.equal(result.world.rooms[0].shapeItemId, "old-room");
  assert.notEqual(result.world.rooms[0].id, "old-room");
  assert.equal(result.world.start, null);
  assert.deepEqual(result.world.rooms[0].exits, []);
});

test("v2 roundtrip keeps semantic IDs and layout independent of geometry", () => {
  const doc = normalizeDocument(legacy());
  const geometry = structuredClone(doc.items);
  doc.world.rooms[0].graphPosition = { x: 5000, y: -3000 };
  const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored, doc);
  assert.deepEqual(restored.items, geometry);
  assert.equal(Object.hasOwn(restored, "blocking"), false);
  assert.equal(Object.hasOwn(restored.items[0], "blocking"), false);
  assert.equal(Object.hasOwn(restored.world.rooms[0], "blockingOrigin"), false);
});

test("OneWay authoring roundtrips explicitly without changing IDs or legacy platform defaults", () => {
  const doc = normalizeDocument(legacy());
  const legacyPlatform = structuredClone(doc.items[1]);
  assert.equal(Object.hasOwn(legacyPlatform, "platformMode"), false);
  doc.items[1].platformMode = "oneway";
  const before = structuredClone(doc);
  const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored, before);
  assert.equal(restored.items[1].id, legacyPlatform.id);
  assert.equal(Object.hasOwn(restored.items[1], "blocking"), false, "reading the file does not assign an import mode");
  assert.deepEqual(doc, before);
  doc.items[1].platformMode = "OneWay";
  assert.throws(() => normalizeDocument(doc), /platformMode/, "unknown enum spelling must not become an ordinary platform");
});

test("moving footprint and center endpoints persist independently of track dimensions and legacy defaults", () => {
  const doc = normalizeDocument(legacy());
  const item = { ...doc.items[1], kind: "moving", x: 64, y: 96, w: 12, h: 1, trackOrientation: "horizontal", trackPosition: .25 };
  doc.items[1] = item;
  const legacyCopy = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(Object.hasOwn(legacyCopy.items[1], "movingPlatformWidth"), false);
  assert.equal(Object.hasOwn(legacyCopy.items[1], "movingPlatformHeight"), false);
  assert.equal(getMovingPlatformLayout(item).widthCells, 3);
  assert.equal(getMovingPlatformLayout(item).heightCells, .5);
  item.movingPlatformWidth = 4;
  item.movingPlatformHeight = .5;
  const before = structuredClone(doc);
  const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored, before);
  assert.deepEqual(doc, before);
  assert.equal(restored.items[1].id, "old-platform");
  const horizontal = getMovingPlatformLayout(item);
  assert.deepEqual(horizontal.start, { x: 64, y: 112 });
  assert.deepEqual(horizontal.end, { x: 448, y: 112 });
  assert.deepEqual(horizontal.center, { x: 160, y: 112 });
  assert.deepEqual(horizontal.platformBounds, { x: 96, y: 104, width: 128, height: 16 });
  assert.deepEqual(horizontal.sweptBounds, { x: 0, y: 104, width: 512, height: 16 });
  const vertical = getMovingPlatformLayout({ ...item, w: 1, h: 10, trackOrientation: "vertical" });
  assert.deepEqual(vertical.start, { x: 80, y: 96 });
  assert.deepEqual(vertical.end, { x: 80, y: 416 });
  assert.deepEqual(vertical.center, { x: 80, y: 176 });
  assert.deepEqual(vertical.sweptBounds, { x: 16, y: 88, width: 128, height: 336 });
  assert.deepEqual(getMovingPlatformLayout({ ...item, trackPosition: 0 }).center, horizontal.start);
  assert.deepEqual(getMovingPlatformLayout({ ...item, trackPosition: 1 }).center, horizontal.end);
  for (const value of [0, -1, 1025, Infinity, NaN, "4", null]) {
    item.movingPlatformWidth = value;
    assert.throws(() => normalizeDocument(doc), /movingPlatformWidth/);
  }
  item.movingPlatformWidth = 4;
  item.movingPlatformHeight = 0;
  assert.throws(() => normalizeDocument(doc), /movingPlatformHeight/);
  item.movingPlatformHeight = .5;
  item.trackPosition = 1.01;
  assert.throws(() => normalizeDocument(doc), /trackPosition/);
});

test("explicit blocking data roundtrips without adopting move-follow links as ownership", () => {
  const doc = normalizeDocument(legacy());
  doc.blocking = { version: 1, enabled: true, centimetersPerCell: 150, depthCm: 240, wallThicknessCm: 25 };
  doc.world.rooms[0].blockingOrigin = { x: 10, y: 20 };
  doc.items[1].blocking = { roomId: doc.world.rooms[0].id, mode: "solid" };
  const copy = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(copy, doc);
  assert.equal(Object.hasOwn(copy.items[0], "blocking"), false);
  assert.equal(copy.items[1].attachedRoomId, "old-room");
  assert.equal(copy.items[1].blocking.roomId, doc.world.rooms[0].id);
  assert.throws(() => normalizeDocument({ ...doc, blocking: { ...doc.blocking, centimetersPerCell: 0 } }), /centimetersPerCell/);
  assert.throws(() => normalizeDocument({ ...doc, items: [{ ...doc.items[0], blocking: { roomId: null, mode: "automatic" } }] }), /mode/);
});

test("rejects future versions and malformed geometry before replacing current work", () => {
  assert.throws(() => normalizeDocument({ ...legacy(), version: 3 }), /Версия/);
  assert.throws(() => normalizeDocument({ ...legacy(), grid: 64 }), /сетки/);
  const broken = legacy();
  broken.paths[0].from.x = "bad";
  assert.throws(() => normalizeDocument(broken), /координаты/);
  const duplicate = legacy();
  duplicate.items[1].id = duplicate.items[0].id;
  assert.throws(() => normalizeDocument(duplicate), /ID/);
  const unknown = legacy();
  unknown.items[0].kind = "unknown";
  assert.throws(() => normalizeDocument(unknown), /тип/);
  const malformedWorld = normalizeDocument(legacy());
  malformedWorld.world.rooms[0].entrances = null;
  assert.throws(() => normalizeDocument(malformedWorld), /список/);
});

test("room routes remain absent in legacy projects and preserve explicit room-local authoring data", () => {
  const doc = normalizeDocument(legacy());
  assert.equal(Object.hasOwn(doc, "routes"), false, "migration must not manufacture designer routes");
  assert.equal(Object.hasOwn(normalizeDocument(JSON.parse(JSON.stringify(doc))), "routes"), false);
  doc.routes = ["main", "optional", "secret", "return"].map((kind, index) => ({
    id: `route-${kind}`, roomId: doc.world.rooms[0].id, name: `Маршрут ${kind}`, kind, color: "#8acD12", visible: index !== 2,
    points: [{ x: -32, y: 64.5 }, { x: 32, y: 16 }, { x: 128, y: 96 }],
  }));
  const before = structuredClone(doc);
  const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored, before);
  assert.deepEqual(doc, before, "normalization never mutates the source");
  restored.routes[0].points[0].x = 500;
  assert.deepEqual(doc, before, "routes are deeply cloned, including their waypoints");
  doc.items[0].x += 320;
  doc.items[0].y -= 160;
  assert.deepEqual(normalizeDocument(doc).routes, before.routes, "moving the room outline does not rewrite room-local coordinates");
  assert.deepEqual(normalizeDocument({ ...doc, routes: [] }).routes, [], "explicit empty route list also roundtrips");
});

test("route ownership, identities and malformed waypoints are rejected before replacing the project", () => {
  const doc = normalizeDocument(legacy());
  doc.routes = [{ id: "route-main", roomId: doc.world.rooms[0].id, name: "Основной", kind: "main", color: "#abcdef", visible: true, points: [{ x: 0, y: 0 }, { x: 64, y: 32 }] }];
  const before = structuredClone(doc);
  const invalid = [
    ["missing room", copy => { copy.routes[0].roomId = "deleted-room"; }, /отсутствующей комнате/],
    ["shape identity is not room ownership", copy => { copy.routes[0].roomId = copy.items[0].id; }, /отсутствующей комнате/],
    ["duplicate route identity", copy => { copy.routes.push(structuredClone(copy.routes[0])); }, /ID/],
    ["item identity collision", copy => { copy.routes[0].id = copy.items[1].id; }, /ID/],
    ["line identity collision", copy => { copy.routes[0].id = copy.paths[0].id; }, /ID/],
    ["missing identity", copy => { delete copy.routes[0].id; }, /ID/],
    ["too few points", copy => { copy.routes[0].points.pop(); }, /от 2 до 2048/],
    ["too many points", copy => { copy.routes[0].points = Array.from({ length: 2049 }, () => ({ x: 0, y: 0 })); }, /от 2 до 2048/],
    ["infinite point", copy => { copy.routes[0].points[0].x = Infinity; }, /координаты/],
    ["NaN point", copy => { copy.routes[0].points[0].y = NaN; }, /координаты/],
    ["string point", copy => { copy.routes[0].points[0].x = "32"; }, /координаты/],
    ["null point", copy => { copy.routes[0].points[0] = null; }, /объект/],
    ["unknown purpose", copy => { copy.routes[0].kind = "teleport"; }, /назначение/],
    ["empty name", copy => { copy.routes[0].name = "  "; }, /имя/],
    ["invalid color", copy => { copy.routes[0].color = "red"; }, /цвет/],
    ["invalid visibility", copy => { copy.routes[0].visible = "false"; }, /видимость/],
    ["invalid collection", copy => { copy.routes = {}; }, /массив/],
  ];
  for (const [name, mutate, message] of invalid) {
    const copy = structuredClone(doc); mutate(copy);
    assert.throws(() => normalizeDocument(copy), message, name);
  }
  assert.deepEqual(doc, before);
});
