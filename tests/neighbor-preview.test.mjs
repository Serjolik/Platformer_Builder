import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/neighbor-preview-model.ts", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const { getNeighborFragments } = await import(moduleUrl);

function fixture() {
  const doc = {
    version: 2, name: "Neighbors", grid: 32, paths: [], inactiveLayerOpacity: .5,
    layers: [{ id: "visible", name: "Visible", visible: true, locked: false }, { id: "hidden", name: "Hidden", visible: false, locked: false }],
    world: { rooms: [
      { id: "a", name: "A", shapeItemId: "shape-a", graphPosition: { x: -1000, y: 5000 }, entrances: [],
        exits: [{ id: "exit-a", name: "A to B", connection: { enabled: true, targetRoomId: "b", targetEntranceId: "entry-b" } }] },
      { id: "b", name: "B", shapeItemId: "shape-b", graphPosition: { x: 5000, y: -1000 }, entrances: [{ id: "entry-b", name: "B from A" }], exits: [] },
    ] },
    items: [
      { id: "shape-a", kind: "room", x: 0, y: 0, w: 10, h: 8, label: "A", color: "#ffffff", layerId: "visible",
        sideTypes: ["straight", "opening", "straight", "straight"], sideTransitions: [null, { endpointId: "exit-a", kind: "exit" }, null, null] },
      { id: "shape-b", kind: "room", x: 2000, y: 3000, w: 12, h: 6, label: "B", color: "#ffffff", layerId: "visible",
        sideTypes: ["straight", "straight", "straight", "opening"], sideTransitions: [null, null, null, { endpointId: "entry-b", kind: "entrance" }] },
      { id: "floor-b", kind: "platform", x: 2000, y: 3160, w: 12, h: 1, label: "Floor", color: "#ffffff", layerId: "visible", blocking: { roomId: "b", mode: "solid" } },
      { id: "hidden-b", kind: "platform", x: 2000, y: 3096, w: 3, h: 1, label: "Hidden", color: "#ffffff", layerId: "hidden", blocking: { roomId: "b", mode: "solid" } },
      { id: "unowned", kind: "platform", x: 2000, y: 3000, w: 1, h: 1, label: "Unowned", color: "#ffffff", layerId: "visible" },
    ],
  };
  return doc;
}

test("neighbors align physical portal floors despite different opening heights and arbitrary graph positions", () => {
  const doc = fixture(), before = structuredClone(doc);
  const [outgoing] = getNeighborFragments(doc, "a");
  assert.equal(outgoing.roomId, "b");
  assert.deepEqual(outgoing.source, { x: 320, y: 256 });
  assert.deepEqual(outgoing.offset, { x: -1680, y: -2936 });
  assert.equal(outgoing.incompatibleSides, false);
  assert.deepEqual(outgoing.items.map(item => item.id), ["shape-b", "floor-b"]);
  assert.deepEqual(doc, before, "preview construction is read-only");
  doc.world.rooms.forEach(room => room.graphPosition = { x: 0, y: 0 });
  assert.deepEqual(getNeighborFragments(doc, "a"), [outgoing], "graph layout never moves physical fragments");
  const [incoming] = getNeighborFragments(doc, "b");
  assert.equal(incoming.roomId, "a");
  assert.deepEqual(incoming.offset, { x: 1680, y: 2936 });
  assert.ok(incoming.window.every(point => point.x <= 2000), "incoming preview sits outside B's left boundary");
});

test("disabled, missing, self-linked and graph-only endpoints produce no speculative previews", () => {
  const doc = fixture();
  doc.world.rooms[0].exits[0].connection.enabled = false;
  assert.deepEqual(getNeighborFragments(doc, "a"), []);
  doc.world.rooms[0].exits[0].connection.enabled = true;
  doc.items[1].sideTransitions = undefined;
  assert.deepEqual(getNeighborFragments(doc, "a"), []);
  doc.world.rooms[0].exits[0].connection.targetRoomId = "a";
  assert.deepEqual(getNeighborFragments(doc, "a"), []);
  assert.deepEqual(getNeighborFragments(doc, "missing"), []);
});

test("reciprocal links with distinct semantic IDs at the same physical pair are deduplicated", () => {
  const doc = fixture();
  doc.world.rooms[0].entrances.push({ id: "entry-a", name: "A from B" });
  doc.world.rooms[1].exits.push({ id: "exit-b", name: "B to A", connection: { enabled: true, targetRoomId: "a", targetEntranceId: "entry-a" } });
  doc.items.push({ ...doc.items[0], id: "extra-a", blocking: { roomId: "a", mode: "outline" }, sideTransitions: [null, { endpointId: "entry-a", kind: "entrance" }, null, null] });
  doc.items.push({ ...doc.items[1], id: "extra-b", blocking: { roomId: "b", mode: "outline" }, sideTransitions: [null, null, null, { endpointId: "exit-b", kind: "exit" }] });
  assert.equal(getNeighborFragments(doc, "a").length, 1);
  assert.equal(getNeighborFragments(doc, "b").length, 1);
});

test("standalone transition markers get an exterior fragment with a tether to their actual location", () => {
  const doc = fixture();
  doc.items[0].sideTransitions = undefined;
  doc.items.push({ id: "marker-a", kind: "transition", label: "Door", color: "#ffffff", x: 240, y: 96, w: 1, h: 2,
    blocking: { roomId: "a", mode: "none" }, transition: { endpointId: "exit-a", kind: "exit" } });
  const [fragment] = getNeighborFragments(doc, "a");
  assert.deepEqual(fragment.source, { x: 256, y: 160 });
  assert.deepEqual(fragment.anchor, { x: 320, y: 160 });
  assert.equal(fragment.offset.y + 3192, 160, "the target floor is aligned with the marker's bottom");
  assert.ok(fragment.window.every(point => point.x >= 320));
});

test("polygon winding does not flip the exterior and mismatched facing remains visible as a warning", () => {
  const doc = fixture();
  const b = doc.items[1];
  b.polygonPoints = [{ x: 0, y: 0 }, { x: 0, y: 192 }, { x: 384, y: 192 }, { x: 384, y: 0 }];
  b.sideTypes = ["opening", "straight", "straight", "straight"];
  b.sideTransitions = [{ endpointId: "entry-b", kind: "entrance" }, null, null, null];
  assert.equal(getNeighborFragments(doc, "a")[0].incompatibleSides, false);
  b.sideTypes = ["straight", "straight", "opening", "straight"];
  b.sideTransitions = [null, null, { endpointId: "entry-b", kind: "entrance" }, null];
  assert.equal(getNeighborFragments(doc, "a")[0].incompatibleSides, true);
});
