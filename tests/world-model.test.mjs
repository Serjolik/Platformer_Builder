import assert from "node:assert/strict";
import test from "node:test";
import {
  connectExit, createEntrance, createExit, createRegion, createRoom, createWorld,
  parseWorld, removeEndpoint, removeRegion, removeRoom, validateWorld,
} from "../app/world-model.ts";

function linkedWorld() {
  const world = createWorld();
  const first = createRoom("Убежище");
  const second = createRoom("Шахта");
  first.entrances.push(createEntrance("Главный вход"));
  second.entrances.push(createEntrance("Лифт"));
  second.exits.push(createExit("К убежищу"));
  second.exits[0].connection.requiredAbilities = ["Dash"];
  second.exits[0].connection.fadeDuration = 1.2;
  world.rooms.push(first, second);
  world.start = { roomId: first.id, entranceId: first.entrances[0].id };
  return connectExit(world, second.id, second.exits[0].id, first.id, first.entrances[0].id);
}

test("legacy room migration preserves shape identities without inventing physical scale or start", () => {
  const shapes = [
    { id: "legacy-1", label: "Тоннель", x: -128, y: 256, w: 8, h: 4 },
    { id: "legacy-2", label: "Зал", x: 960, y: -64, w: 32, h: 10 },
  ];
  const original = structuredClone(shapes);
  const world = createWorld(shapes);
  assert.deepEqual(shapes, original);
  assert.deepEqual(world.rooms.map(room => room.shapeItemId), ["legacy-1", "legacy-2"]);
  assert.deepEqual(world.rooms.map(room => room.name), ["Тоннель", "Зал"]);
  assert.equal(new Set(world.rooms.map(room => room.id)).size, 2);
  for (const room of world.rooms) {
    assert.match(room.id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
    assert.notEqual(room.id, room.shapeItemId);
    assert.equal(room.regionId, null);
    assert.deepEqual(room.designSizeCm, { x: 4000, z: 2000 });
    assert.equal(room.entrances.length + room.exits.length, 0);
  }
  assert.equal(world.start, null);
  assert.equal(createWorld().rooms.length, 0);
  assert.deepEqual(parseWorld(JSON.parse(JSON.stringify(world))), world);
});

test("single authoritative passage reaches both directions and GameStart does not occupy the entrance", () => {
  const world = linkedWorld();
  const issues = validateWorld(world);
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(world.rooms[0].exits.length, 0, "no reverse record is created");
  assert.equal(world.rooms[1].exits[0].connection.requiredAbilities[0], "Dash");
  assert.deepEqual(parseWorld(JSON.parse(JSON.stringify(world))), world);

  const isolated = createRoom("Отдельный остров");
  isolated.entrances.push(createEntrance());
  const unreachable = validateWorld({ ...world, rooms: [...world.rooms, isolated] });
  assert.ok(unreachable.some(issue => issue.roomId === isolated.id && /недостижима/.test(issue.message)));
  const disabled = structuredClone(world);
  disabled.rooms[1].exits[0].connection.enabled = false;
  assert.ok(validateWorld(disabled).some(issue => issue.roomId === disabled.rooms[1].id && /недостижима/.test(issue.message)));
});

test("connecting an occupied entrance fails without mutations, reconnecting the owner keeps settings", () => {
  const world = linkedWorld();
  const target = world.rooms[0];
  const source = createRoom("Мост");
  source.exits.push(createExit());
  world.rooms.push(source);
  const before = structuredClone(world);
  assert.throws(() => connectExit(world, source.id, source.exits[0].id, target.id, target.entrances[0].id), /уже занят/);
  assert.deepEqual(world, before);
  const owner = world.rooms[1];
  const reconnected = connectExit(world, owner.id, owner.exits[0].id, target.id, target.entrances[0].id);
  assert.equal(reconnected.rooms[1].exits[0].connection.fadeDuration, 1.2);
  assert.deepEqual(reconnected.rooms[1].exits[0].connection.requiredAbilities, ["Dash"]);
  assert.notEqual(reconnected, world);
  assert.throws(() => connectExit(world, source.id, "missing", target.id, target.entrances[0].id), /выход не найден/);
  assert.throws(() => connectExit(world, source.id, source.exits[0].id, target.id, "missing"), /вход не найден/);
});

test("optional exit graph appearance roundtrips strictly without changing passage identity or settings", () => {
  const world = linkedWorld();
  const source = world.rooms[1], target = world.rooms[0];
  assert.equal(Object.hasOwn(source.exits[0], "graphStyle"), false, "old projects and new exits retain automatic appearance");
  source.exits[0].graphStyle = { color: "#aB12eF", lineStyle: "dashed" };
  const before = structuredClone(world);
  const parsed = parseWorld(JSON.parse(JSON.stringify(world)));
  assert.deepEqual(parsed, before);
  assert.notEqual(parsed.rooms[1].exits[0].graphStyle, source.exits[0].graphStyle);
  const reconnected = connectExit(parsed, source.id, source.exits[0].id, target.id, target.entrances[0].id);
  assert.deepEqual(reconnected.rooms[1].exits[0].graphStyle, source.exits[0].graphStyle);
  assert.deepEqual(reconnected.rooms[1].exits[0].connection, source.exits[0].connection);
  assert.equal(reconnected.rooms[1].exits[0].id, source.exits[0].id);
  assert.deepEqual(world, before);
  for (const graphStyle of [null, [], {}, { color: "red", lineStyle: "solid" }, { color: "#123", lineStyle: "solid" },
    { color: "#abcdef00", lineStyle: "solid" }, { color: "#abcdef", lineStyle: "dotted" }]) {
    const invalid = structuredClone(world);
    invalid.rooms[1].exits[0].graphStyle = graphStyle;
    assert.throws(() => parseWorld(invalid), /graphStyle/);
  }
  source.exits[0].graphStyle = { color: "#000000", lineStyle: "solid" };
  assert.deepEqual(parseWorld(world), world);
});

test("connection lookup and occupancy use GUID identity without rewriting imported object IDs", () => {
  const world = linkedWorld();
  const target = world.rooms[0];
  const owner = world.rooms[1];
  target.id = target.id.toUpperCase();
  owner.exits[0].id = owner.exits[0].id.toUpperCase();
  owner.exits[0].connection.targetRoomId = target.id.toLowerCase();
  owner.exits[0].connection.targetEntranceId = target.entrances[0].id.toUpperCase();
  const rival = createRoom("Другой выход");
  rival.exits.push(createExit("Занять вход"));
  world.rooms.push(rival);
  const before = structuredClone(world);
  assert.throws(() => connectExit(world, rival.id.toUpperCase(), rival.exits[0].id.toUpperCase(),
    target.id.toLowerCase(), target.entrances[0].id), /уже занят/);
  assert.deepEqual(world, before, "failed occupancy validation does not change imported references");

  const reconnected = connectExit(world, owner.id.toUpperCase(), owner.exits[0].id.toLowerCase(),
    target.id.toLowerCase(), target.entrances[0].id.toUpperCase());
  assert.equal(reconnected.rooms[0], target);
  assert.equal(reconnected.rooms[1].id, owner.id);
  assert.equal(reconnected.rooms[1].exits[0].id, owner.exits[0].id);
  assert.deepEqual(reconnected.rooms[1].exits[0].connection, {
    ...owner.exits[0].connection, targetRoomId: target.id, targetEntranceId: target.entrances[0].id,
  }, "references use actual object spelling while gates and fade settings survive");
  assert.deepEqual(world, before);
  owner.exits[0].connection.enabled = false;
  const connectedRival = connectExit(world, rival.id, rival.exits[0].id, target.id, target.entrances[0].id);
  assert.equal(connectedRival.rooms[2].exits[0].connection.enabled, true, "a disabled imported reference does not reserve the entrance");
});

test("validation catches duplicate IDs, duplicate occupancy and dangling references without rejecting editable data", () => {
  const world = linkedWorld();
  const source = world.rooms[1];
  const duplicate = createExit("Вторая связь");
  duplicate.connection = { ...source.exits[0].connection };
  source.exits.push(duplicate);
  source.regionId = crypto.randomUUID();
  let issues = validateWorld(parseWorld(JSON.parse(JSON.stringify(world))));
  assert.ok(issues.some(issue => /несколько проходов/.test(issue.message)));
  assert.ok(issues.some(issue => issue.severity === "warning" && /отсутствует регион/.test(issue.message)));
  source.exits[1].id = source.exits[0].id;
  source.exits[1].connection.targetEntranceId = crypto.randomUUID();
  issues = validateWorld(world);
  assert.ok(issues.some(issue => /Повторяющийся ID/.test(issue.message)));
  assert.ok(issues.some(issue => /отсутствует вход/.test(issue.message)));
  source.exits[1].connection.targetRoomId = crypto.randomUUID();
  assert.ok(validateWorld(world).some(issue => /отсутствует целевая комната/.test(issue.message)));
  world.start.entranceId = crypto.randomUUID();
  assert.ok(validateWorld(world).some(issue => /Не найден стартовый вход/.test(issue.message)));
});

test("entrance and exit IDs have independent namespaces for Unreal compatibility", () => {
  const world = linkedWorld();
  world.rooms[1].exits[0].id = world.rooms[1].entrances[0].id;
  assert.deepEqual(validateWorld(world), []);
  world.rooms[0].entrances.push({ ...world.rooms[1].entrances[0] });
  assert.ok(validateWorld(world).some(issue => /Повторяющийся ID/.test(issue.message)));
});

test("removing a region only ungroups its rooms, removing endpoints clears owned references and start", () => {
  const world = linkedWorld();
  const region = createRegion("Подземелье");
  world.regions.push(region);
  world.rooms.forEach(room => { room.regionId = region.id; });
  const original = structuredClone(world);
  const ungrouped = removeRegion(world, region.id);
  assert.equal(ungrouped.rooms.length, 2);
  assert.ok(ungrouped.rooms.every(room => room.regionId === null));
  assert.deepEqual(ungrouped.rooms[1].exits, world.rooms[1].exits);
  assert.deepEqual(world, original);

  const target = world.rooms[0];
  const removed = removeEndpoint(world, target.id, "entrance", target.entrances[0].id);
  assert.equal(removed.start, null);
  assert.equal(removed.rooms[0].entrances.length, 0);
  assert.equal(removed.rooms[1].exits[0].connection.enabled, false);
  assert.equal(removed.rooms[1].exits[0].connection.targetRoomId, null);
  assert.equal(removed.rooms[1].exits[0].connection.targetEntranceId, null);
  assert.deepEqual(removed.rooms[1].exits[0].connection.requiredAbilities, ["Dash"]);
  const source = world.rooms[1];
  const exitRemoved = removeEndpoint(world, source.id, "exit", source.exits[0].id);
  assert.equal(exitRemoved.rooms[1].exits.length, 0);
  assert.deepEqual(exitRemoved.start, world.start);
  assert.deepEqual(world, original);
});

test("removing a room clears both enabled and disabled references while preserving other content", () => {
  const world = linkedWorld();
  const disabled = createExit("Запланированный проход");
  disabled.connection.targetRoomId = world.rooms[0].id;
  disabled.connection.targetEntranceId = world.rooms[0].entrances[0].id;
  world.rooms[1].exits.push(disabled);
  const original = structuredClone(world);
  const removed = removeRoom(world, world.rooms[0].id);
  assert.equal(removed.rooms.length, 1);
  assert.equal(removed.start, null);
  assert.equal(removed.rooms[0].id, world.rooms[1].id);
  assert.ok(removed.rooms[0].exits.every(exit => !exit.connection.enabled && exit.connection.targetRoomId === null && exit.connection.targetEntranceId === null));
  assert.deepEqual(world, original);
});

test("structural parser rejects malformed nested data before rendering instead of resetting it", () => {
  const mutations = [
    [world => { world.rooms[0].entrances = [null]; }, /entrances/],
    [world => { world.rooms[0].graphPosition.x = Infinity; }, /graphPosition.x/],
    [world => { world.rooms[0].designSizeCm.z = -1; }, /designSizeCm.z/],
    [world => { world.rooms[0].tags = [7]; }, /tags/],
    [world => { world.rooms[0].status = "constructor"; }, /status/],
    [world => { world.rooms[1].exits[0].connection.requiredAbilities = ["Fly"]; }, /requiredAbilities/],
    [world => { world.rooms[1].exits[0].connection.enabled = "true"; }, /enabled/],
    [world => { world.settings.transitionTimeout = 4; }, /transitionTimeout/],
    [world => { world.regions = [{ ...createRegion("Регион"), color: "red" }]; }, /color/],
    [world => { delete world.start; }, /start/],
  ];
  for (const [mutate, message] of mutations) {
    const world = linkedWorld();
    mutate(world);
    assert.throws(() => parseWorld(world), message);
  }
  assert.throws(() => parseWorld(null), /Мир/);
  assert.throws(() => parseWorld([]), /Мир/);
  const original = linkedWorld();
  const parsed = parseWorld(original);
  parsed.rooms[0].name = "Изменённая копия";
  assert.equal(original.rooms[0].name, "Убежище");
});
