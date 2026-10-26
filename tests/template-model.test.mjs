import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const cached = new Map();
async function moduleUrl(name) {
  if (cached.has(name)) return cached.get(name);
  let output = ts.transpileModule(await readFile(new URL(`../app/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...output.matchAll(/from "\.\/([^\"]+)"/g)]) output = output.replace(match[0], `from ${JSON.stringify(await moduleUrl(match[1]))}`);
  const result = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  cached.set(name, result);
  return result;
}
const { emptyDocument, normalizeDocument } = await import(await moduleUrl("map-document"));
const { createTemplate, instantiateTemplate, parseTemplateLibrary, serializeTemplateLibrary, mergeTemplateLibraries } = await import(await moduleUrl("template-model"));
const block = (id, x, y, extra = {}) => ({ id, kind: "platform", label: id, color: "#66aabb", x, y, w: 4, h: 1, layerId: "layer-gameplay", ...extra });

test("template detaches source identities, preserves local polygons and relative placement", () => {
  const document = emptyDocument();
  document.items = [block("room", 0, 0, { kind: "room" }), block("p", 64, 96, { attachedRoomId: "room", blocking: { roomId: "old-world-room", mode: "solid" }, polygonPoints: [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 96, y: 32 }] }), block("enemy", 96, 32, { kind: "enemy", blocking: { roomId: "old-world-room", mode: "blueprint" } }), block("transition", 20, 20, { kind: "transition", transition: { endpointId: "source-endpoint", kind: "exit" } })];
  const before = structuredClone(document);
  const template = createTemplate(document, document.items.map(item => item.id), "  Ниша  ");
  assert.equal(template.name, "Ниша");
  assert.equal(template.items.length, 2);
  assert.deepEqual(template.items[0].polygonPoints, document.items[1].polygonPoints);
  assert.deepEqual(template.items.map(item => [item.x, item.y]), [[0, 64], [32, 0]]);
  for (const item of template.items) for (const field of ["id", "layerId", "attachedRoomId", "blocking", "transition", "sideTransitions"]) assert.equal(Object.hasOwn(item, field), false);
  assert.deepEqual(document, before);
});

test("every insertion mints distinct item IDs and assigns destination ownership and layer", () => {
  const document = emptyDocument();
  document.items = [block("p", 64, 96, { platformMode: "oneway", blocking: { roomId: "old-room", mode: "blueprint" } }), block("door", 192, 96, { kind: "door", keyName: "key", transition: { endpointId: "unwanted", kind: "exit" }, sideTransitions: [{ endpointId: "unwanted", kind: "entrance" }] })];
  const template = createTemplate(document, ["p", "door"], "Дверь и платформа");
  const options = { position: { x: 320, y: 640 }, layerId: "destination-layer", roomId: "destination-room", shapeItemId: "destination-shape" };
  const first = instantiateTemplate(template, options), second = instantiateTemplate(template, options);
  assert.equal(new Set([...first, ...second].map(item => item.id)).size, 4);
  assert.deepEqual(first.map(item => [item.x, item.y]), [[320, 640], [448, 640]]);
  for (const item of first) {
    assert.equal(item.blocking.roomId, "destination-room"); assert.equal(item.layerId, "destination-layer"); assert.equal(item.attachedRoomId, "destination-shape");
    assert.equal(Object.hasOwn(item, "transition"), false); assert.equal(Object.hasOwn(item, "sideTransitions"), false);
  }
  assert.equal(first[0].platformMode, "oneway"); assert.equal(first[0].blocking.mode, "blueprint");
  const loose = instantiateTemplate(template, { position: { x: 0, y: 0 }, layerId: "layer-gameplay" });
  assert.equal(loose[0].blocking.roomId, null); assert.equal(Object.hasOwn(loose[0], "attachedRoomId"), false);
  assert.doesNotThrow(() => normalizeDocument({ ...emptyDocument(), items: loose }));
});

test("moving platform footprint and endpoints survive library roundtrip without shifting twice", () => {
  const document = emptyDocument();
  document.items = [block("ferry", 320, 640, { kind: "moving", w: 10, h: 1, trackOrientation: "horizontal", trackPosition: .375, movingPlatformWidth: 4, movingPlatformHeight: .5 })];
  const template = createTemplate(document, ["ferry"], "Паром");
  assert.equal(template.width, 14 * 32);
  assert.equal(template.items[0].x, 64);
  const imported = parseTemplateLibrary(JSON.parse(JSON.stringify(serializeTemplateLibrary([template]))));
  assert.deepEqual(imported, [template]);
  assert.deepEqual(parseTemplateLibrary(serializeTemplateLibrary(imported)), imported);
  assert.deepEqual(mergeTemplateLibraries(imported, imported), imported);
});

test("invalid imports fail atomically; portable fields never retain foreign binding IDs", () => {
  const document = emptyDocument(); document.items = [block("p", 0, 0)];
  const template = createTemplate(document, ["p"], "Пол");
  const original = serializeTemplateLibrary([template]);
  for (const mutate of [d => { d.version = 2; }, d => { d.templates[0].items[0].x = Infinity; }, d => { d.templates[0].items[0].kind = "room"; }, d => { d.templates[0].items[0].kind = "transition"; }, d => { d.templates[0].items[0].polygonPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: NaN, y: 2 }]; }, d => { d.templates.push(structuredClone(d.templates[0])); }, d => { d.templates[0].items[0].movingPlatformWidth = -1; }]) {
    const invalid = structuredClone(original); mutate(invalid); assert.throws(() => parseTemplateLibrary(invalid));
  }
  const foreign = structuredClone(original);
  Object.assign(foreign.templates[0].items[0], { id: "old-id", attachedRoomId: "old-shape", blocking: { roomId: "old-room", mode: "solid" }, transition: { endpointId: "old-endpoint" }, extra: "old-world-id" });
  assert.deepEqual(parseTemplateLibrary(foreign), [template]);
  assert.deepEqual(original, serializeTemplateLibrary([template]));
});
