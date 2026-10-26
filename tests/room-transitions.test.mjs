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
const { emptyDocument, normalizeDocument } = await import(documentUrl);
const { createRoom, createEntrance, createExit, connectExit, removeEndpoint } = await import(modelUrl);
const { assignRoomTransition, removeRoomTransition, getRoomTransitionOwner, getRoomTransitionBinding,
  getRoomTransitionEndpoint, reconcileRoomTransitions, splitSideTransitions, extrudeSideTransitions,
  removeVertexSideTransitions } = await import(transitionsUrl);

function fixture() {
  const doc = emptyDocument();
  const first = createRoom("Первая");
  const second = createRoom("Вторая");
  first.shapeItemId = "контур";
  first.entrances = [createEntrance("Ручной вход")];
  second.exits = [createExit("Ручной выход")];
  doc.world.rooms = [first, second];
  doc.items = [
    { id: "контур", kind: "room", label: "Комната", color: "#ffffff", x: 0, y: 0, w: 10, h: 6,
      layerId: doc.layers[1].id, polygonPoints: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 192 }, { x: 0, y: 192 }],
      sideTypes: ["door", "opening", "straight", "straight"] },
    { id: "маркер", kind: "transition", label: "Дверь в зал", color: "#ffffff", x: 40, y: 40, w: 1, h: 2,
      layerId: doc.layers[1].id, blocking: { mode: "none", roomId: first.id } },
  ];
  return doc;
}

const item = (doc, id = "маркер") => doc.items.find(value => value.id === id);
const bound = (doc, id = "маркер", sideIndex) => getRoomTransitionEndpoint(doc, item(doc, id), sideIndex);
const changeItem = (doc, id, update) => ({ ...doc, items: doc.items.map(value => value.id === id ? update(value) : value) });

test("explicit assignment creates one stable point and syncs names without touching manual endpoints", () => {
  const source = fixture();
  const before = structuredClone(source);
  const assigned = assignRoomTransition(source, "маркер", "exit");
  const point = bound(assigned);
  assert.ok(point.id);
  assert.equal(point.name, "Дверь в зал");
  assert.equal(assigned.world.rooms[0].exits.length, 1);
  assert.deepEqual(assigned.world.rooms[0].entrances, source.world.rooms[0].entrances);
  assert.deepEqual(source, before);
  assert.equal(reconcileRoomTransitions(assigned, assigned), assigned, "a no-op keeps the document and IDs unchanged");
  const renamed = reconcileRoomTransitions(assigned, changeItem(assigned, "маркер", value => ({ ...value, label: "Тоннель" })));
  assert.equal(bound(renamed).name, "Тоннель");
  assert.equal(bound(renamed).id, point.id);
  const graphEdit = structuredClone(renamed);
  graphEdit.world.rooms[0].exits[0].name = "Имя из графа";
  graphEdit.world.rooms[0].exits[0].overrideFacing = true;
  const synced = reconcileRoomTransitions(renamed, graphEdit);
  assert.equal(item(synced).label, "Имя из графа");
  assert.equal(bound(synced).overrideFacing, true);
  assert.equal(bound(synced).id, point.id);
});

test("deleting a bound entrance cleans incoming references and GameStart; graph deletion never resurrects it", () => {
  let doc = assignRoomTransition(fixture(), "маркер", "entrance");
  const room = doc.world.rooms[0], source = doc.world.rooms[1];
  const entrance = bound(doc), manual = room.entrances[0];
  doc.world = connectExit(doc.world, source.id, source.exits[0].id, room.id, entrance.id);
  doc.world.rooms[1].exits[0].connection.requiredTags = ["Keep.Gate"];
  doc.world.rooms[1].exits[0].connection.targetRoomId = room.id.toUpperCase();
  doc.world.rooms[1].exits[0].connection.targetEntranceId = entrance.id.toUpperCase();
  doc.world.start = { roomId: room.id.toUpperCase(), entranceId: entrance.id.toUpperCase() };
  const before = structuredClone(doc);
  const removed = reconcileRoomTransitions(doc, { ...doc, items: doc.items.filter(value => value.id !== "маркер") });
  assert.deepEqual(removed.world.rooms[0].entrances, [manual]);
  assert.equal(removed.world.start, null);
  const connection = removed.world.rooms[1].exits[0].connection;
  assert.equal(connection.enabled, false);
  assert.equal(connection.targetRoomId, null);
  assert.equal(connection.targetEntranceId, null);
  assert.deepEqual(connection.requiredTags, ["Keep.Gate"]);
  assert.deepEqual(doc, before);
  const graphDeleted = reconcileRoomTransitions(doc, { ...doc, world: removeEndpoint(doc.world, room.id, "entrance", entrance.id) });
  assert.equal(item(graphDeleted).transition, undefined);
  assert.equal(graphDeleted.world.rooms[0].entrances.length, 1);
  assert.equal(graphDeleted.world.start, null);
  assert.deepEqual(normalizeDocument(graphDeleted), graphDeleted);
});

test("role switches keep the GUID and arrival settings while retiring old-role references", () => {
  let doc = assignRoomTransition(fixture(), "маркер", "entrance");
  const entrance = bound(doc), room = doc.world.rooms[0], other = doc.world.rooms[1];
  entrance.preservePlayerDepth = false;
  entrance.maximumPlacementAdjustmentCm = 75;
  doc.world = connectExit(doc.world, other.id, other.exits[0].id, room.id, entrance.id);
  doc.world.start = { roomId: room.id, entranceId: entrance.id };
  const asExit = assignRoomTransition(doc, "маркер", "exit");
  assert.equal(bound(asExit).id, entrance.id);
  assert.equal(bound(asExit).preservePlayerDepth, false);
  assert.equal(bound(asExit).maximumPlacementAdjustmentCm, 75);
  assert.equal(bound(asExit).connection.enabled, false);
  assert.equal(asExit.world.start, null);
  assert.equal(asExit.world.rooms[1].exits[0].connection.enabled, false);
  assert.equal(asExit.world.rooms[0].entrances.length, 1);
  bound(asExit).connection.requiredTags = ["Do.Not.Inherit"];
  const asEntrance = assignRoomTransition(asExit, "маркер", "entrance");
  assert.equal(bound(asEntrance).id, entrance.id);
  assert.equal(Object.hasOwn(bound(asEntrance), "connection"), false);
  assert.deepEqual(assignRoomTransition(asEntrance, "маркер", "exit").world.rooms[0].exits[0].connection.requiredTags, []);
});

test("moving multiple bound points to another owner preserves IDs, connections and start references atomically", () => {
  let doc = fixture();
  doc.items.push({ ...item(doc), id: "маркер-выход", label: "Выход" });
  doc = assignRoomTransition(doc, "маркер", "entrance");
  doc = assignRoomTransition(doc, "маркер-выход", "exit");
  const first = doc.world.rooms[0], second = doc.world.rooms[1];
  const entrance = bound(doc), exit = bound(doc, "маркер-выход");
  doc.world = connectExit(doc.world, first.id, exit.id, first.id, entrance.id);
  doc.world.start = { roomId: first.id, entranceId: entrance.id };
  const next = { ...doc, items: doc.items.map(value => value.kind === "transition"
    ? { ...value, blocking: { mode: "none", roomId: second.id.toUpperCase() } } : value) };
  const moved = reconcileRoomTransitions(doc, next);
  assert.equal(moved.world.rooms[0].entrances.length, 1);
  assert.equal(moved.world.rooms[0].exits.length, 0);
  assert.equal(bound(moved).id, entrance.id);
  const movedExit = bound(moved, "маркер-выход");
  assert.equal(movedExit.id, exit.id);
  assert.equal(movedExit.connection.enabled, true);
  assert.equal(movedExit.connection.targetRoomId, second.id);
  assert.equal(movedExit.connection.targetEntranceId, entrance.id);
  assert.deepEqual(moved.world.start, { roomId: second.id, entranceId: entrance.id });
});

test("split, extrusion and vertex removal keep side bindings aligned without duplicating GUIDs", () => {
  let doc = assignRoomTransition(fixture(), "контур", "entrance", 0);
  doc = assignRoomTransition(doc, "контур", "exit", 1);
  const shape = item(doc, "контур");
  const entranceId = shape.sideTransitions[0].endpointId, exitId = shape.sideTransitions[1].endpointId;
  const splitShape = { ...shape, polygonPoints: [shape.polygonPoints[0], { x: 160, y: 0 }, ...shape.polygonPoints.slice(1)],
    sideTypes: ["door", "door", ...shape.sideTypes.slice(1)], sideTransitions: splitSideTransitions(shape, 0) };
  const split = reconcileRoomTransitions(doc, changeItem(doc, "контур", () => splitShape));
  assert.deepEqual(item(split, "контур").sideTransitions.map(value => value?.endpointId ?? null), [entranceId, null, exitId, null, null]);
  assert.equal(split.world.rooms[0].entrances.length, 2);
  assert.equal(split.world.rooms[0].exits.length, 1);
  const extruded = extrudeSideTransitions(shape, 0);
  assert.deepEqual(extruded.map(value => value?.endpointId ?? null), [null, entranceId, null, exitId, null, null]);
  const shortened = { ...splitShape, polygonPoints: splitShape.polygonPoints.filter((_, index) => index !== 2),
    sideTypes: splitShape.sideTypes.filter((_, index) => index !== 2), sideTransitions: removeVertexSideTransitions(splitShape, 2) };
  const removed = reconcileRoomTransitions(split, changeItem(split, "контур", () => shortened));
  assert.equal(removed.world.rooms[0].exits.length, 0);
  assert.equal(removed.world.rooms[0].entrances.length, 2);
  assert.equal(getRoomTransitionBinding(item(removed, "контур"), 0).endpointId, entranceId);
  const walled = reconcileRoomTransitions(removed, changeItem(removed, "контур", value => ({ ...value, sideTypes: value.sideTypes.map(() => "straight") })));
  assert.equal(walled.world.rooms[0].entrances.length, 1, "turning the bound door into a wall retires only its owned point");
  assert.ok(item(walled, "контур").sideTransitions.every(value => value === null));
});

test("complete projects roundtrip bindings; malformed or orphaned imports fail without assigning identities", () => {
  let doc = assignRoomTransition(fixture(), "контур", "exit", 0);
  doc = assignRoomTransition(doc, "маркер", "entrance");
  const before = structuredClone(doc);
  assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))), before);
  const orphan = structuredClone(doc);
  orphan.world.rooms[0].exits = [];
  assert.throws(() => normalizeDocument(orphan), /точка отсутствует/);
  const duplicate = structuredClone(doc);
  item(duplicate, "контур").sideTransitions[1] = { ...item(duplicate, "контур").sideTransitions[0] };
  assert.throws(() => normalizeDocument(duplicate), /нескольким объектам/);
  const misaligned = structuredClone(doc);
  item(misaligned, "контур").sideTransitions.pop();
  assert.throws(() => normalizeDocument(misaligned), /число привязок/);
  const invalidRole = structuredClone(doc);
  item(invalidRole).transition.kind = "bidirectional";
  assert.throws(() => normalizeDocument(invalidRole), /роль/);
  assert.deepEqual(doc, before);
});

test("ownership never follows move attachments; deleting a semantic room detaches its preserved drawing", () => {
  const draft = fixture();
  delete item(draft).blocking;
  item(draft).attachedRoomId = "контур";
  assert.equal(getRoomTransitionOwner(draft, item(draft)), null);
  assert.throws(() => assignRoomTransition(draft, "маркер", "exit"), /Сначала выберите комнату/);
  let doc = assignRoomTransition(fixture(), "маркер", "entrance");
  doc = assignRoomTransition(doc, "контур", "exit", 0);
  const deleted = reconcileRoomTransitions(doc, { ...doc, world: { ...doc.world, rooms: doc.world.rooms.slice(1) } });
  assert.equal(item(deleted).transition, undefined);
  assert.ok(item(deleted, "контур").sideTransitions.every(value => value === null));
  assert.equal(item(deleted).blocking.roomId, doc.world.rooms[0].id, "unrelated draft ownership is not silently reassigned");
  assert.deepEqual(normalizeDocument(deleted), deleted);
  const removed = removeRoomTransition(doc, "маркер");
  assert.equal(removed.world.rooms[0].entrances.length, 1);
  const adoption = changeItem(fixture(), "маркер", value => ({ ...value, transition: { kind: "entrance", endpointId: doc.world.rooms[0].entrances[0].id } }));
  const base = fixture();
  adoption.world = base.world;
  item(adoption).blocking.roomId = base.world.rooms[0].id;
  item(adoption).transition.endpointId = base.world.rooms[0].entrances[0].id;
  assert.throws(() => reconcileRoomTransitions(base, adoption), /ручную точку/);
});
