import assert from "node:assert/strict";
import test from "node:test";
import { createRoom, createWorld } from "../app/world-model.ts";
import {
  assignItemBlocking, createBlockingSettings, getBlockingSettings, getItemBlocking,
  defaultItemBlockingMode, getItemBlueprintAnchorPixels, getItemPolygonPixels, isSimplePolygon,
  parseBlockingSettings, polygonContainsPolygon, prepareBlocking, supportsBlueprintPlacement, setItemPlatformMode,
} from "../app/blocking-model.ts";

function fixture() {
  const world = createWorld();
  const room = createRoom("Мастерская");
  room.blockingOrigin = { x: 64, y: 128 };
  world.rooms.push(room);
  const item = { id: "old-string-object-id", kind: "platform", label: "Пол", color: "#ffffff", x: 96, y: 160, w: 4, h: 1,
    blocking: { roomId: room.id, mode: "solid" } };
  return { version: 2, name: "Блокинг", grid: 32, items: [item], paths: [], layers: [], inactiveLayerOpacity: .32,
    world, blocking: { ...createBlockingSettings(), enabled: true } };
}
const errors = result => result.issues.filter(issue => issue.severity === "error");
const rectangle = (left, top, right, bottom) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];

test("OneWay edits preserve identity and disabled assignments while preventing solid-collision export", () => {
  const doc = fixture();
  const original = structuredClone(doc.items[0]);
  assert.equal(defaultItemBlockingMode("platform", "oneway"), "blueprint");
  const edited = setItemPlatformMode(doc.items[0], "oneway");
  assert.deepEqual(doc.items[0], original, "explicit mode changes are immutable");
  assert.equal(edited.id, original.id);
  assert.deepEqual(edited.blocking, { roomId: original.blocking.roomId, mode: "blueprint" });
  assert.equal(setItemPlatformMode({ ...original, blocking: { ...original.blocking, mode: "none" } }, "oneway").blocking.mode, "none");
  const unassigned = { ...original }; delete unassigned.blocking;
  assert.equal(Object.hasOwn(setItemPlatformMode(unassigned, "oneway"), "blocking"), false);
  assert.equal(setItemPlatformMode(edited, "normal").blocking.mode, "blueprint", "changing drawing mode back does not overwrite import intent");
  doc.items[0] = edited;
  const valid = prepareBlocking(doc);
  assert.deepEqual(errors(valid), []);
  assert.deepEqual(valid.objects, []);
  assert.equal(valid.entities[0].sourceId, original.id);
  assert.ok(valid.issues.some(issue => /OneWay.*Подтип платформы автоматически не переносится/.test(issue.message)));
  doc.items[0].blocking.mode = "solid";
  const invalid = prepareBlocking(doc);
  assert.ok(errors(invalid).some(issue => /OneWay нельзя импортировать как сплошной блок/.test(issue.message)));
  assert.deepEqual(invalid.objects, []);
});

test("moving platforms stay Blueprint markers with legacy anchors and cannot export their track as a solid", () => {
  const doc = fixture();
  doc.items[0] = { ...doc.items[0], kind: "moving", trackPosition: .25, trackOrientation: "vertical", movingPlatformWidth: 6, movingPlatformHeight: .5,
    blocking: { ...doc.items[0].blocking, mode: "blueprint" } };
  const before = structuredClone(doc);
  assert.equal(defaultItemBlockingMode("moving"), "blueprint");
  const prepared = prepareBlocking(doc);
  assert.deepEqual(errors(prepared), []);
  assert.deepEqual(prepared.objects, []);
  assert.deepEqual(prepared.entities[0], { sourceId: "old-string-object-id", kind: "moving", roomId: doc.world.rooms[0].id, locationCm: { x: 300, y: 0, z: -200 } });
  assert.equal(prepared.issues.filter(issue => /Движущиеся платформы: 1/.test(issue.message)).length, 1);
  assert.deepEqual(doc, before);
  doc.items[0].blocking.mode = "solid";
  const invalid = prepareBlocking(doc);
  assert.ok(errors(invalid).some(issue => issue.itemId === doc.items[0].id && /движущуюся платформу/.test(issue.message)));
  assert.deepEqual(invalid.objects, []);
  assert.deepEqual(invalid.entities, []);
});

test("explicit origin and scale produce room-local X/Z geometry independently of graph placement", () => {
  const doc = fixture();
  const before = structuredClone(doc);
  const prepared = prepareBlocking(doc);
  assert.deepEqual(errors(prepared), []);
  assert.deepEqual(prepared.objects[0].locationCm, { x: 100, y: 0, z: -100 });
  assert.deepEqual(prepared.objects[0].localVerticesCm, [{ x: 0, z: -0 }, { x: 400, z: -0 }, { x: 400, z: -100 }, { x: 0, z: -100 }]);
  assert.equal(prepared.objects[0].sourceId, "old-string-object-id");
  doc.world.rooms[0].graphPosition = { x: 100000, y: -200000 };
  doc.world.rooms[0].designSizeCm = { x: 1, z: 500000 };
  assert.deepEqual(prepareBlocking(doc).objects, prepared.objects);
  doc.world.rooms[0].graphPosition = before.world.rooms[0].graphPosition;
  doc.world.rooms[0].designSizeCm = before.world.rooms[0].designSizeCm;
  assert.deepEqual(doc, before);
});

test("legacy absence is disabled and automatic follow never establishes physical room ownership", () => {
  const doc = fixture();
  delete doc.blocking;
  delete doc.items[0].blocking;
  doc.items[0].attachedRoomId = "some-drawing-outline";
  const before = structuredClone(doc);
  assert.equal(getBlockingSettings(doc).enabled, false);
  assert.deepEqual(getItemBlocking(doc.items[0]), { roomId: null, mode: "none" });
  assert.deepEqual(prepareBlocking(doc), { objects: [], entities: [], issues: [] });
  assert.deepEqual(doc, before);
  doc.blocking = { ...createBlockingSettings(), enabled: true };
  assert.equal(prepareBlocking(doc).objects.length, 0);
  const assigned = assignItemBlocking(doc.items[0], doc.world.rooms[0].id, "solid");
  assert.notEqual(assigned, doc.items[0]);
  assert.equal(assigned.attachedRoomId, "some-drawing-outline");
  assert.equal(Object.hasOwn(doc.items[0], "blocking"), false);
});

test("unknown owner or missing origin blocks only explicitly enabled physical imports", () => {
  const doc = fixture();
  doc.items[0].blocking.roomId = crypto.randomUUID();
  assert.ok(errors(prepareBlocking(doc)).some(issue => /существующая комната/.test(issue.message)));
  doc.items[0].blocking.roomId = doc.world.rooms[0].id.toUpperCase();
  assert.deepEqual(errors(prepareBlocking(doc)), []);
  delete doc.world.rooms[0].blockingOrigin;
  assert.ok(errors(prepareBlocking(doc)).some(issue => /начало координат/.test(issue.message)));
  doc.blocking.enabled = false;
  assert.deepEqual(prepareBlocking(doc), { objects: [], entities: [], issues: [] });
});

test("concave simple polygons and forward collinear subdivisions are accepted in both windings", () => {
  const doc = fixture();
  doc.items[0].kind = "liquid";
  doc.items[0].polygonPoints = [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }, { x: 32, y: 32 }, { x: 32, y: 64 }, { x: 0, y: 64 }];
  assert.deepEqual(errors(prepareBlocking(doc)), []);
  assert.ok(prepareBlocking(doc).issues.some(issue => /поведение жидкости/.test(issue.message)));
  doc.items[0].polygonPoints.reverse();
  assert.deepEqual(errors(prepareBlocking(doc)), []);
  assert.ok(isSimplePolygon(doc.items[0].polygonPoints));
});

test("self-crossing, nonadjacent touching, backtracking and degenerate shapes are rejected", () => {
  const invalid = [
    [{ x: 0, y: 0 }, { x: 64, y: 64 }, { x: 64, y: 0 }, { x: 0, y: 64 }],
    [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 32, y: 32 }, { x: 64, y: 64 }, { x: 0, y: 64 }, { x: 32, y: 32 }],
    [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 64 }, { x: 0, y: 64 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 64, y: 64 }],
    rectangle(0, 0, .0001, .0001),
  ];
  for (const polygon of invalid) {
    const doc = fixture();
    doc.items[0].polygonPoints = polygon;
    assert.ok(errors(prepareBlocking(doc)).length > 0, JSON.stringify(polygon));
    assert.equal(prepareBlocking(doc).objects.length, 0);
  }
});

test("outline mode retains explicit openings and marks breakable walls as placeholders", () => {
  const doc = fixture();
  doc.items[0].kind = "room";
  doc.items[0].blocking.mode = "outline";
  doc.items[0].sideTypes = ["straight", "door", "opening", "breakable"];
  const result = prepareBlocking(doc);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(result.objects[0].sideTypes, doc.items[0].sideTypes);
  assert.ok(result.issues.some(issue => /целиком останутся открытыми/.test(issue.message)));
  assert.ok(result.issues.some(issue => /без механики разрушения/.test(issue.message)));
  doc.items[0].sideTypes = ["opening", "door", "opening", "door"];
  const allOpen = prepareBlocking(doc);
  assert.deepEqual(errors(allOpen), []);
  assert.equal(allOpen.objects[0].sourceId, doc.items[0].id, "an empty outline keeps its managed identity");
  assert.deepEqual(allOpen.objects[0].sideTypes, doc.items[0].sideTypes);
  doc.items[0].sideTypes[0] = "waves";
  assert.ok(errors(prepareBlocking(doc)).some(issue => /волнистая/.test(issue.message)));
  doc.items[0].sideTypes = ["straight"];
  assert.ok(errors(prepareBlocking(doc)).some(issue => /число типов/.test(issue.message)));
  doc.items[0].blocking.mode = "solid";
  assert.ok(errors(prepareBlocking(doc)).some(issue => /нельзя заполнять/.test(issue.message)));
});

test("physical range checks happen after unit conversion and enforce runtime limits", () => {
  const doc = fixture();
  doc.items[0].x = 1e9;
  doc.items[0].w = 100;
  doc.items[0].h = 100;
  doc.blocking.centimetersPerCell = .01;
  assert.deepEqual(errors(prepareBlocking(doc)), []);
  doc.blocking.centimetersPerCell = 100;
  assert.ok(errors(prepareBlocking(doc)).some(issue => /диапазон/.test(issue.message)));
  for (const patch of [{ centimetersPerCell: .001 }, { depthCm: .01 }, { wallThicknessCm: 1e7 }, { enabled: "true" }, { version: 2 }])
    assert.throws(() => parseBlockingSettings({ ...createBlockingSettings(), ...patch }));
  const tooMany = fixture();
  tooMany.items[0].polygonPoints = Array.from({ length: 257 }, (_, index) => ({ x: Math.cos(index * Math.PI * 2 / 257) * 100, y: Math.sin(index * Math.PI * 2 / 257) * 100 }));
  assert.ok(errors(prepareBlocking(tooMany)).some(issue => /256/.test(issue.message)));
});

test("explicit preparation containment checks full edges through concavities and preserves boundaries", () => {
  const room = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(polygonContainsPolygon(room, rectangle(1, 1, 9, 2)), false, "vertices inside both arms are insufficient");
  assert.equal(polygonContainsPolygon(room, rectangle(0, 0, 3, 7)), true);
  assert.equal(polygonContainsPolygon(room, rectangle(1, 8, 9, 9)), true);
  assert.equal(polygonContainsPolygon(room, rectangle(-1, 8, 9, 9)), false);
  const item = fixture().items[0];
  assert.deepEqual(getItemPolygonPixels(item), rectangle(96, 160, 224, 192));
});

test("Blueprint placement uses a fixed bottom-center anchor and preserves opaque identity without stretching or gameplay payload", () => {
  const doc = fixture();
  const item = doc.items[0];
  item.kind = "door";
  item.keyName = "AncientKey";
  item.blocking.mode = "blueprint";
  item.blocking.roomId = item.blocking.roomId.toUpperCase();
  const before = structuredClone(doc);
  const prepared = prepareBlocking(doc);
  assert.deepEqual(errors(prepared), []);
  assert.deepEqual(prepared.objects, []);
  assert.deepEqual(prepared.entities, [{ sourceId: item.id, kind: "door", roomId: doc.world.rooms[0].id,
    locationCm: { x: 300, y: 0, z: -200 } }]);
  assert.deepEqual(getItemBlueprintAnchorPixels(item), { x: 160, y: 192 });
  assert.deepEqual(doc, before);
  assert.ok(prepared.issues.some(issue => /Классы по типам выбираются в Unreal/.test(issue.message)));
  item.x = doc.world.rooms[0].blockingOrigin.x = 1e50;
  item.y = doc.world.rooms[0].blockingOrigin.y = -1e50;
  assert.deepEqual(prepareBlocking(doc).entities[0].locationCm, { x: 200, y: 0, z: -100 }, "common large offsets do not erase the local anchor");
});

test("Blueprint polygon bounds determine only placement and do not require a physical collision contour", () => {
  const doc = fixture();
  const item = doc.items[0];
  item.kind = "liquid";
  item.blocking.mode = "blueprint";
  item.polygonPoints = [{ x: -32, y: -32 }, { x: 96, y: 64 }, { x: 96, y: -32 }, { x: -32, y: 64 }];
  const prepared = prepareBlocking(doc);
  assert.deepEqual(errors(prepared), []);
  assert.deepEqual(prepared.entities[0].locationCm, { x: 200, y: 0, z: -300 });
  item.polygonPoints = Array.from({ length: 257 }, () => ({ x: 32, y: 64 }));
  assert.deepEqual(errors(prepareBlocking(doc)), [], "collision polygon constraints do not apply to a Blueprint anchor");
  assert.deepEqual(prepareBlocking(doc).entities[0].locationCm, prepared.entities[0].locationCm);
});

test("Blueprint placement requires an allowed kind, semantic room, fixed origin and bounded converted position", () => {
  const doc = fixture();
  const item = doc.items[0];
  item.blocking.mode = "blueprint";
  for (const kind of ["room", "note", "comment"]) {
    item.kind = kind;
    assert.equal(supportsBlueprintPlacement(kind), false);
    assert.equal(prepareBlocking(doc).entities.length, 0);
    assert.ok(errors(prepareBlocking(doc)).some(issue => /размещение Blueprint недоступно/.test(issue.message)));
  }
  item.kind = "enemy";
  item.blocking.roomId = crypto.randomUUID();
  assert.ok(errors(prepareBlocking(doc)).some(issue => /существующая комната/.test(issue.message)));
  item.blocking.roomId = doc.world.rooms[0].id;
  delete doc.world.rooms[0].blockingOrigin;
  assert.ok(errors(prepareBlocking(doc)).some(issue => /начало координат/.test(issue.message)));
  doc.world.rooms[0].blockingOrigin = { x: 0, y: 0 };
  item.x = 1e9;
  assert.ok(errors(prepareBlocking(doc)).some(issue => /якорь Blueprint выходит/.test(issue.message)));
  assert.equal(defaultItemBlockingMode("enemy"), "blueprint");
  assert.equal(defaultItemBlockingMode("platform"), "solid");
  assert.equal(defaultItemBlockingMode("platform", "crumble"), "blueprint");
  assert.equal(defaultItemBlockingMode("note"), "none");
});
