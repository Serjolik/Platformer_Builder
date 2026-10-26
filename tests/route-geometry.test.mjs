import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/route-geometry.ts", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const { preserveRoutesDuringBoundaryEdit } = await import(moduleUrl);
const fixture = () => ({
  items: [{ id: "shape-a", kind: "room", x: 100, y: 200 }, { id: "platform", kind: "platform", x: 130, y: 220 }],
  world: { rooms: [{ id: "a", shapeItemId: "shape-a" }, { id: "b", shapeItemId: "shape-b" }] },
  routes: [{ id: "route-a", roomId: "a", points: [{ x: 20, y: 30 }, { x: 90, y: 70 }] },
    { id: "route-b", roomId: "b", points: [{ x: 10, y: 20 }, { x: 50, y: 60 }] }],
});
const change = (doc, id, x, y) => ({ ...doc, items: doc.items.map(item => item.id === id ? { ...item, x, y } : item) });
const worldPoints = doc => doc.routes[0].points.map(p => ({ x: p.x + doc.items[0].x, y: p.y + doc.items[0].y }));

test("boundary origin changes keep route world positions fixed across repeated drag updates and reversal", () => {
  const initial = fixture(), before = structuredClone(initial), expected = worldPoints(initial);
  let current = initial;
  for (const [x, y] of [[80, 160], [64, 128], [96, 176], [100, 200]]) {
    const proposed = change(current, "shape-a", x, y);
    current = preserveRoutesDuringBoundaryEdit(current, proposed, "shape-a");
    assert.deepEqual(worldPoints(current), expected);
    assert.equal(current.routes[1], initial.routes[1], "another room's route remains untouched");
    assert.equal(current.items[1], initial.items[1], "contents stay at their existing coordinates");
  }
  assert.deepEqual(current.routes, initial.routes, "returning the boundary to its start does not accumulate drift");
  assert.deepEqual(initial, before, "the undo snapshot is never mutated");
});

test("non-room edits, unchanged origins and documents without routes are no-ops", () => {
  const doc = fixture();
  for (const [id, x, y] of [["platform", 80, 160], ["shape-a", 100, 200], ["missing", 0, 0]]) {
    const proposed = change(doc, id, x, y);
    assert.equal(preserveRoutesDuringBoundaryEdit(doc, proposed, id), proposed);
  }
  const noRoutes = { ...doc, routes: undefined }, proposed = change(noRoutes, "shape-a", 0, 0);
  assert.equal(preserveRoutesDuringBoundaryEdit(noRoutes, proposed, "shape-a"), proposed);
});
