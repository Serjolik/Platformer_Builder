import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const modelUrl = moduleUrl(await readFile(new URL("../app/world-model.ts", import.meta.url), "utf8"));
const blockingUrl = moduleUrl(await readFile(new URL("../app/blocking-model.ts", import.meta.url), "utf8"));
const transitionsUrl = moduleUrl(await readFile(new URL("../app/room-transitions.ts", import.meta.url), "utf8"));
const documentUrl = moduleUrl((await readFile(new URL("../app/map-document.ts", import.meta.url), "utf8"))
  .replace('"./world-model"', JSON.stringify(modelUrl)).replace('"./blocking-model"', JSON.stringify(blockingUrl))
  .replace('"./room-transitions"', JSON.stringify(transitionsUrl)));
const exportUrl = moduleUrl((await readFile(new URL("../app/unreal-export.ts", import.meta.url), "utf8"))
  .replace('"./map-document"', JSON.stringify(documentUrl)).replace('"./world-model"', JSON.stringify(modelUrl))
  .replace('"./blocking-model"', JSON.stringify(blockingUrl)));
const { normalizeDocument, emptyDocument } = await import(documentUrl);
const { buildUnrealExport, defaultUnrealExportOptions, getUnrealExportCategory } = await import(exportUrl);
const { createRoom, createRegion, createEntrance, createExit, connectExit } = await import(modelUrl);

function connectedDocument() {
  const doc = emptyDocument();
  const region = createRegion("Пустошь");
  const first = createRoom("Вход", { x: -1000, y: 2000 }, region.id);
  const second = createRoom("Зал", { x: 5000, y: -1000 });
  first.entrances.push(createEntrance());
  first.exits.push(createExit());
  second.entrances.push(createEntrance());
  doc.world.regions.push(region);
  doc.world.rooms.push(first, second);
  doc.world.start = { roomId: first.id, entranceId: first.entrances[0].id };
  doc.world = connectExit(doc.world, first.id, first.exits[0].id, second.id, second.entrances[0].id);
  return doc;
}

test("repeated Unreal exports preserve migrated semantic IDs and original object strings", () => {
  const legacy = {
    version: 1, name: "Старая локация", grid: 32,
    items: [{ id: "контур-старый-42", kind: "room", label: "Зал", x: 96, y: -32, w: 10, h: 4, color: "#9aafbc" }],
    paths: [],
  };
  const migrated = normalizeDocument(legacy);
  const before = structuredClone(migrated);
  const first = buildUnrealExport(migrated);
  const second = buildUnrealExport(first.document);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
  assert.deepEqual(first.document, before);
  assert.deepEqual(second.document, before);
  assert.equal(second.document.world.rooms[0].shapeItemId, "контур-старый-42");
  assert.deepEqual(migrated, before);
  assert.ok(first.warnings.some(issue => /пока не создаются/.test(issue.message)));
});

test("export refuses migration and future formats instead of generating new identities", () => {
  for (const version of [1, 3, undefined]) {
    const input = { version, name: "Исходник", grid: 32, items: [], paths: [] };
    const before = structuredClone(input);
    const review = buildUnrealExport(input);
    assert.equal(review.document, null);
    assert.equal(review.errors.length, 1);
    assert.match(review.errors[0].message, /версии 2/);
    assert.deepEqual(input, before);
  }
});

test("FGuid comparisons ignore case without rewriting exported IDs or object geometry", () => {
  const doc = connectedDocument();
  const first = doc.world.rooms[0];
  const second = doc.world.rooms[1];
  first.id = first.id.toUpperCase();
  first.regionId = first.regionId.toUpperCase();
  first.exits[0].connection.targetRoomId = second.id.toUpperCase();
  first.exits[0].connection.targetEntranceId = second.entrances[0].id.toUpperCase();
  const before = structuredClone(doc);
  const review = buildUnrealExport(doc);
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document, before);
  assert.deepEqual(doc, before);

  second.id = first.id.toLowerCase();
  assert.ok(buildUnrealExport(doc).errors.some(issue => /Повторяющийся ID/.test(issue.message)));
});

test("invalid GUIDs, enums and dangling links block export; authoring omissions remain warnings", () => {
  const unfinished = emptyDocument();
  unfinished.world.rooms.push(createRoom("Планируемая комната"));
  assert.deepEqual(buildUnrealExport(unfinished).errors, []);
  assert.ok(buildUnrealExport(unfinished).warnings.some(issue => /старт игры/.test(issue.message)));

  const invalidId = connectedDocument();
  invalidId.world.id = "00000000-0000-0000-0000-000000000000";
  assert.ok(buildUnrealExport(invalidId).errors.some(issue => /ID мира/.test(issue.message)));
  const invalidType = connectedDocument();
  invalidType.world.rooms[0].roomType = "Unknown";
  assert.ok(buildUnrealExport(invalidType).errors.some(issue => /roomType/.test(issue.message)));
  const dangling = connectedDocument();
  dangling.world.rooms[0].exits[0].connection.targetEntranceId = crypto.randomUUID();
  assert.ok(buildUnrealExport(dangling).errors.some(issue => /отсутствует вход/.test(issue.message)));
  const missingRegion = connectedDocument();
  missingRegion.world.regions = [];
  assert.ok(buildUnrealExport(missingRegion).errors.some(issue => /отсутствует регион/.test(issue.message)));
});

test("one enabled passage per entrance is checked using UE GUID identity", () => {
  const doc = connectedDocument();
  const second = createExit("Ещё один проход");
  second.connection = { ...doc.world.rooms[0].exits[0].connection };
  second.connection.targetRoomId = second.connection.targetRoomId.toUpperCase();
  second.connection.targetEntranceId = second.connection.targetEntranceId.toUpperCase();
  doc.world.rooms[0].exits.push(second);
  assert.ok(buildUnrealExport(doc).errors.some(issue => /несколько проходов/.test(issue.message)));
});

test("drawing bindings cannot prevent metadata export and are preserved for later blocking support", () => {
  const doc = connectedDocument();
  doc.world.rooms.forEach(room => { room.shapeItemId = "not-a-present-shape"; });
  const before = structuredClone(doc);
  const review = buildUnrealExport(doc);
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document, before);
  assert.deepEqual(doc, before);
});

test("export readiness matches Unreal for disabled drafts, package paths and float bounds", () => {
  const draft = connectedDocument();
  const connection = draft.world.rooms[0].exits[0].connection;
  connection.enabled = false;
  connection.targetEntranceId = null;
  assert.deepEqual(buildUnrealExport(draft).errors, []);
  assert.ok(buildUnrealExport(draft).warnings.some(issue => /Черновик сохранится/.test(issue.message)));
  connection.targetEntranceId = crypto.randomUUID();
  assert.ok(buildUnrealExport(draft).errors.some(issue => /отсутствующий вход/.test(issue.message)));
  connection.targetRoomId = crypto.randomUUID();
  connection.targetEntranceId = null;
  assert.ok(buildUnrealExport(draft).errors.some(issue => /отсутствующую комнату/.test(issue.message)));
  for (const folder of ["/Game", "/Game/Worlds/", "/Game//Worlds", "/Game/Bad Folder", "/Game/Bad.Path", "/Game/Bad\nPath"]) {
    const doc = connectedDocument();
    doc.world.settings.assetFolder = folder;
    assert.ok(buildUnrealExport(doc).errors.some(issue => /Папка создания/.test(issue.message)), folder);
  }
  const unicode = connectedDocument();
  unicode.world.settings.assetFolder = "/Game/Миры/Подземелье";
  assert.deepEqual(buildUnrealExport(unicode).errors, []);
  const tooLarge = connectedDocument();
  tooLarge.world.rooms[0].graphPosition.x = 1e50;
  assert.ok(buildUnrealExport(tooLarge).errors.some(issue => /числовой диапазон/.test(issue.message)));
});

test("blocking export retains source identity and checks converted coordinates instead of canvas offsets", () => {
  const doc = connectedDocument();
  const room = doc.world.rooms[0];
  room.blockingOrigin = { x: 1e50, y: -1e50 };
  doc.blocking = { version: 1, enabled: true, centimetersPerCell: 100, depthCm: 200, wallThicknessCm: 20 };
  doc.items.push({ id: "исходный-объект-42", kind: "platform", label: "Пол", color: "#ffffff", x: 1e50, y: -1e50,
    w: 4, h: 1, layerId: doc.layers[1].id, blocking: { roomId: room.id.toUpperCase(), mode: "solid" } });
  const before = structuredClone(doc);
  const review = buildUnrealExport(doc);
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document, before);
  assert.deepEqual(buildUnrealExport(review.document).document, before);
  doc.items[0].blocking.roomId = crypto.randomUUID();
  assert.ok(buildUnrealExport(doc).errors.some(issue => issue.itemId === doc.items[0].id));
  doc.blocking.enabled = false;
  assert.deepEqual(buildUnrealExport(doc).errors, [], "disabled import keeps editable draft bindings");
});

test("explicit Blueprint export roundtrips original IDs and gameplay annotations without adding native class mappings", () => {
  const doc = connectedDocument();
  const room = doc.world.rooms[0];
  room.blockingOrigin = { x: 32, y: 96 };
  doc.blocking = { version: 1, enabled: true, centimetersPerCell: 100, depthCm: 200, wallThicknessCm: 20 };
  doc.items.push({ id: "дверь-на-рисунке", kind: "door", label: "Дверь", color: "#ffffff", x: 64, y: 32,
    w: 1, h: 2, keyName: "OldKey", layerId: doc.layers[1].id, blocking: { roomId: room.id, mode: "blueprint" } });
  const before = structuredClone(doc);
  const first = buildUnrealExport(doc);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.document, before);
  assert.deepEqual(buildUnrealExport(first.document).document, before);
  assert.ok(first.warnings.some(issue => /Размещение Blueprint: 1/.test(issue.message)));
  assert.deepEqual(doc, before);
  doc.items[0].kind = "note";
  assert.ok(buildUnrealExport(doc).errors.some(issue => issue.itemId === doc.items[0].id));
  doc.blocking.enabled = false;
  assert.deepEqual(buildUnrealExport(doc).errors, []);
});

function scopedDocument() {
  const doc = connectedDocument();
  const room = doc.world.rooms[0];
  room.blockingOrigin = { x: 0, y: 192 };
  room.shapeItemId = "исходный-контур";
  doc.blocking = { version: 1, enabled: false, centimetersPerCell: 100, depthCm: 200, wallThicknessCm: 20 };
  const item = (id, kind, mode) => ({ id, kind, label: id, color: "#ffffff", x: 32, y: 32,
    w: 2, h: 1, layerId: doc.layers[1].id, blocking: { roomId: room.id, mode } });
  doc.items = [
    { ...item(room.shapeItemId, "room", "outline"), x: 0, y: 0, w: 10, h: 6 },
    { ...item("пол-постоянный", "platform", "solid"), attachedRoomId: room.shapeItemId },
    item("дверь-постоянная", "door", "blueprint"),
    item("враг-постоянный", "enemy", "blueprint"),
    item("босс-постоянный", "boss", "blueprint"),
    item("заметка", "note", "none"),
  ];
  doc.paths = [{ id: "маршрут-редактора", kind: "line", from: { x: 0, y: 0 }, to: { x: 32, y: 64 },
    color: "#ffffff", layerId: doc.layers[1].id }];
  return doc;
}

test("scoped engine transfers preserve source identities and cannot be opened as editable projects", () => {
  const doc = scopedDocument();
  const before = structuredClone(doc);
  const options = defaultUnrealExportOptions();
  const first = buildUnrealExport(doc, options);
  const repeated = buildUnrealExport(doc, options);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(repeated.document, first.document);
  assert.equal(first.document.version, 3);
  assert.equal(first.document.format, "mapconstructor-unreal");
  assert.deepEqual(first.document.exportScope, { version: 1, ...options });
  assert.deepEqual(first.document.items.map(item => item.id), doc.items.slice(0, 5).map(item => item.id));
  assert.deepEqual(first.document.world, doc.world);
  assert.deepEqual(first.document.paths, []);
  assert.equal(first.document.blocking.enabled, true, "export selection supersedes the legacy authoring toggle");
  assert.deepEqual(first.document.items[1], doc.items[1], "selected contour keeps the drawing attachment valid");
  assert.deepEqual(doc, before, "source remains the complete editable v2 document");
  assert.throws(() => normalizeDocument(first.document), /файл для импортёра Unreal.*Полный проект/);
  assert.equal(buildUnrealExport(first.document, options).document, null, "a partial transfer cannot become a new source");
  assert.equal(getUnrealExportCategory(doc.items[3]), "enemies");
  assert.equal(getUnrealExportCategory(doc.items[4]), "enemies");
  assert.equal(getUnrealExportCategory(doc.items[5]), null);
});

test("OneWay remains explicit in full and scoped payloads and cannot silently become solid geometry", () => {
  const doc = scopedDocument();
  const platform = doc.items[1];
  platform.platformMode = "oneway";
  platform.blocking.mode = "blueprint";
  const before = structuredClone(doc);
  assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))), before);
  const review = buildUnrealExport(doc, defaultUnrealExportOptions());
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document.items.find(item => item.id === platform.id), platform);
  assert.equal(getUnrealExportCategory(platform), "objects");
  assert.ok(review.warnings.some(issue => /Платформы OneWay: 1/.test(issue.message)));
  const geometryOnly = buildUnrealExport(doc, { roomContours: false, geometry: true, objects: false, enemies: false, logic: false });
  assert.deepEqual(geometryOnly.errors, []);
  assert.equal(geometryOnly.document.items.some(item => item.id === platform.id), false);
  assert.deepEqual(doc, before);
  platform.blocking.mode = "solid";
  assert.ok(buildUnrealExport(doc, defaultUnrealExportOptions()).errors.some(issue => issue.itemId === platform.id && /OneWay/.test(issue.message)));
  doc.blocking.enabled = true;
  assert.ok(buildUnrealExport(doc).errors.some(issue => issue.itemId === platform.id && /OneWay/.test(issue.message)));
});

test("moving platform authoring dimensions remain in JSON without silently importing a static track", () => {
  const doc = scopedDocument();
  const moving = doc.items[1];
  Object.assign(moving, { kind: "moving", movingPlatformWidth: 4, movingPlatformHeight: .5, trackOrientation: "vertical", trackPosition: .125 });
  moving.blocking.mode = "blueprint";
  const before = structuredClone(doc);
  assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))), before);
  const review = buildUnrealExport(doc, defaultUnrealExportOptions());
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document.items.find(item => item.id === moving.id), moving);
  assert.equal(getUnrealExportCategory(moving), "objects");
  assert.ok(review.warnings.some(issue => /Движущиеся платформы: 1/.test(issue.message) && /не применяются к Blueprint/.test(issue.message)));
  assert.deepEqual(doc, before);
  moving.blocking.mode = "solid";
  assert.ok(buildUnrealExport(doc, defaultUnrealExportOptions()).errors.some(issue => issue.itemId === moving.id && /движущуюся платформу/.test(issue.message)));
});

test("only selected categories constrain engine validation and excluded references are not exported", () => {
  const doc = scopedDocument();
  const room = doc.world.rooms[0];
  doc.world.startGraphPosition = { x: 1e50, y: -1e50 };
  room.exits[0].connection.targetRoomId = crypto.randomUUID();
  doc.items[0].polygonPoints = [{ x: 0, y: 0 }, { x: 64, y: 64 }, { x: 0, y: 64 }, { x: 64, y: 0 }];
  doc.items[3].blocking.roomId = crypto.randomUUID();
  const options = { roomContours: false, geometry: true, objects: false, enemies: false, logic: false };
  const before = structuredClone(doc);
  const review = buildUnrealExport(doc, options);
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document.items.map(item => item.id), ["пол-постоянный"]);
  assert.equal(review.document.items[0].attachedRoomId, undefined);
  assert.equal(review.document.items[0].blocking.roomId, room.id);
  assert.equal(review.document.world.rooms[0].shapeItemId, room.shapeItemId, "source identity binding remains in catalog metadata");
  assert.equal(review.document.world.start, null);
  assert.deepEqual(review.document.world.startGraphPosition, { x: 0, y: 0 });
  assert.ok(review.document.world.rooms.every(room => room.entrances.length === 0 && room.exits.length === 0));
  assert.ok(!review.warnings.some(issue => /старт игры|нет входов и выходов|недостижима/.test(issue.message)));
  assert.ok(buildUnrealExport(doc, { ...options, logic: true }).errors.some(issue => issue.exitId));
  assert.ok(buildUnrealExport(doc, { ...options, roomContours: true }).errors.some(issue => issue.itemId === doc.items[0].id));
  assert.ok(buildUnrealExport(doc, { ...options, enemies: true }).errors.some(issue => issue.itemId === doc.items[3].id));
  assert.deepEqual(doc, before);
});

test("catalog-only transfers retain mandatory identity checks and require explicit boolean scope", () => {
  const doc = scopedDocument();
  const options = { roomContours: false, geometry: false, objects: false, enemies: false, logic: false };
  const review = buildUnrealExport(doc, options);
  assert.deepEqual(review.errors, []);
  assert.deepEqual(review.document.items, []);
  assert.equal(review.document.blocking.enabled, false);
  assert.deepEqual(review.document.world.rooms.map(room => room.id), doc.world.rooms.map(room => room.id));
  assert.equal(buildUnrealExport(doc, { ...options, enemies: "false" }).document, null);
  doc.world.rooms[0].id = "invalid-guid";
  assert.ok(buildUnrealExport(doc, options).errors.some(issue => /Некорректный ID/.test(issue.message)));
});

test("graph-only wire appearance survives full backup but never changes either Unreal payload", () => {
  const doc = connectedDocument();
  const legacy = JSON.stringify(buildUnrealExport(doc).document);
  const scoped = JSON.stringify(buildUnrealExport(doc, defaultUnrealExportOptions()).document);
  for (const graphStyle of [{ color: "#aBc123", lineStyle: "solid" }, { color: "#ff4400", lineStyle: "dashed" }]) {
    doc.world.rooms[0].exits[0].graphStyle = graphStyle;
    const before = structuredClone(doc);
    const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(restored, before, "full editable backup retains appearance and IDs");
    const legacyReview = buildUnrealExport(restored);
    const scopedReview = buildUnrealExport(restored, defaultUnrealExportOptions());
    assert.deepEqual(legacyReview.errors, []);
    assert.deepEqual(scopedReview.errors, []);
    assert.equal(JSON.stringify(legacyReview.document), legacy, "legacy native payload remains byte-equivalent");
    assert.equal(JSON.stringify(scopedReview.document), scoped, "scoped native payload remains byte-equivalent");
    assert.equal(Object.hasOwn(scopedReview.document.world.rooms[0].exits[0], "graphStyle"), false);
    assert.deepEqual(restored, before);
    assert.deepEqual(doc, before);
  }
});

test("room routes survive editable project files but never affect either Unreal payload or reimport fingerprint", () => {
  const doc = scopedDocument();
  const legacy = JSON.stringify(buildUnrealExport(doc).document);
  const scoped = JSON.stringify(buildUnrealExport(doc, defaultUnrealExportOptions()).document);
  const logicOff = { ...defaultUnrealExportOptions(), logic: false };
  const scopedWithoutLogic = JSON.stringify(buildUnrealExport(doc, logicOff).document);
  for (const visible of [true, false]) {
    doc.routes = [{ id: "editor-route-stable-id", roomId: doc.world.rooms[0].id, name: "Через секрет", kind: "secret", color: "#bb55ff", visible,
      points: [{ x: 0, y: 96 }, { x: 96, y: 32 }, { x: 192, y: 160 }] }];
    const before = structuredClone(doc);
    const restored = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(restored, before, "full project retains named route, owner, waypoint order and visibility");
    for (const [options, expected] of [[undefined, legacy], [defaultUnrealExportOptions(), scoped], [logicOff, scopedWithoutLogic]]) {
      const review = options === undefined ? buildUnrealExport(restored) : buildUnrealExport(restored, options);
      assert.deepEqual(review.errors, []);
      assert.equal(Object.hasOwn(review.document, "routes"), false, "authoring routes have no Unreal import category");
      assert.equal(JSON.stringify(review.document), expected, "route edits must not change a gameplay reimport fingerprint");
    }
    assert.deepEqual(restored, before);
    assert.deepEqual(doc, before, "export never removes routes from the editable source");
  }
});
