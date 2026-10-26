"use client";

import { useState, type ReactNode } from "react";
import {
  ABILITIES, ROOM_STATUSES, ROOM_TYPES, TRANSITION_TYPES,
  connectExit, createEntrance, createExit, removeEndpoint, removeRegion,
  type Ability, type WorldData, type WorldEntrance, type WorldExit, type WorldExitGraphStyle, type WorldRoom,
} from "./world-model";
import "./inspector-polish.css";

export type WorldSelection =
  | { kind: "world" }
  | { kind: "region"; regionId: string }
  | { kind: "room"; roomId: string }
  | { kind: "entrance"; roomId: string; endpointId: string }
  | { kind: "exit"; roomId: string; endpointId: string }
  | { kind: "start" };

type InspectorProps = {
  world: WorldData;
  selection: WorldSelection;
  onChange: (world: WorldData) => void;
  onSelect: (selection: WorldSelection) => void;
  shapes: { id: string; label: string }[];
  onOpenBlockout: (roomId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  blockingSettings?: ReactNode;
  renderRoomBlocking?: (roomId: string) => ReactNode;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="world-inspector-section"><h3>{title}</h3>{children}</section>;
}

function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return <details className="world-inspector-advanced"><summary>{title}</summary>{children}</details>;
}

function TextField({ label, value, onCommit, multiline = false, required = false, placeholder }: {
  label: string; value: string; onCommit: (value: string) => void;
  multiline?: boolean; required?: boolean; placeholder?: string;
}) {
  const commit = (element: HTMLInputElement | HTMLTextAreaElement) => {
    const next = element.value.trim();
    if (required && !next) { element.value = value; return; }
    if (next !== value) onCommit(next);
  };
  const props = {
    defaultValue: value, placeholder,
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(event.currentTarget),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); }
      if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault(); event.currentTarget.blur();
      }
    },
  };
  return <label className="world-inspector-field"><span>{label}</span>{multiline
    ? <textarea key={value} {...props} rows={3} />
    : <input key={value} {...props} type="text" />}</label>;
}

function NumberField({ label, value, onCommit, min = 0, max }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number;
}) {
  return <label className="world-inspector-field"><span>{label}</span>
    <input key={value} type="number" defaultValue={value} min={min} max={max} step="any"
      onBlur={(event) => {
        const input = event.currentTarget;
        const next = input.valueAsNumber;
        if (!Number.isFinite(next) || next < min || (max !== undefined && next > max)) {
          input.value = String(value); return;
        }
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); }
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      }} />
  </label>;
}

function CheckField({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  return <label className="world-inspector-check"><input type="checkbox" checked={checked} disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.checked)} /><span>{label}</span></label>;
}

function TagsField({ label, values, onCommit }: { label: string; values: string[]; onCommit: (values: string[]) => void }) {
  return <TextField label={label} value={values.join(", ")} placeholder="Через запятую"
    onCommit={(value) => onCommit([...new Set(value.split(/[,;\n]/).map((tag) => tag.trim()).filter(Boolean))])} />;
}

function Identity({ id }: { id: string }) {
  return <details className="world-inspector-id"><summary>Постоянный ID</summary><code>{id}</code></details>;
}

function withRoom(world: WorldData, roomId: string, update: (room: WorldRoom) => WorldRoom): WorldData {
  return { ...world, rooms: world.rooms.map((room) => room.id === roomId ? update(room) : room) };
}

function StartInspector({ world, onChange, onSelect }: Pick<InspectorProps, "world" | "onChange" | "onSelect">) {
  const room = world.rooms.find((candidate) => candidate.id === world.start?.roomId);
  const entrance = room?.entrances.find((candidate) => candidate.id === world.start?.entranceId);
  return <>
    <h2>Начало игры</h2>
    <p className="world-inspector-hint">Игрок появится у выбранного входа. Этот вход можно использовать и для переходов.</p>
    <label className="world-inspector-field"><span>Стартовая комната</span>
      <select value={room?.id ?? ""} onChange={(event) => {
        const target = world.rooms.find((candidate) => candidate.id === event.currentTarget.value);
        onChange({ ...world, start: target?.entrances[0] ? { roomId: target.id, entranceId: target.entrances[0].id } : null });
      }}>
        <option value="">Не назначена</option>
        {world.rooms.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={!candidate.entrances.length}>
          {candidate.name}{!candidate.entrances.length ? " — нет входов" : ""}
        </option>)}
      </select>
    </label>
    {room && <label className="world-inspector-field"><span>Стартовый вход</span>
      <select value={entrance?.id ?? ""} onChange={(event) => {
        if (event.currentTarget.value) onChange({ ...world, start: { roomId: room.id, entranceId: event.currentTarget.value } });
      }}>
        {!entrance && <option value="">Выберите вход</option>}
        {room.entrances.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>}
    {world.start && (!room || !entrance) && <p className="world-inspector-error">Назначенный вход не найден. Выберите существующий вход.</p>}
    {!world.rooms.some((candidate) => candidate.entrances.length) && <p className="world-inspector-hint">Сначала добавьте комнату и хотя бы один вход в её свойствах.</p>}
    <div className="world-inspector-actions">
      {room && <button type="button" onClick={() => onSelect({ kind: "room", roomId: room.id })}>К свойствам комнаты</button>}
      {world.start && <button type="button" onClick={() => onChange({ ...world, start: null })}>Снять назначение</button>}
    </div>
  </>;
}

function EndpointInspector({ world, room, endpoint, kind, onChange, onSelect }: {
  world: WorldData; room: WorldRoom; endpoint: WorldEntrance | WorldExit; kind: "entrance" | "exit";
  onChange: InspectorProps["onChange"]; onSelect: InspectorProps["onSelect"];
}) {
  const [error, setError] = useState<string | null>(null);
  const patchEndpoint = (patch: Partial<WorldEntrance>) => onChange(withRoom(world, room.id, (current) => kind === "entrance"
    ? { ...current, entrances: current.entrances.map((item) => item.id === endpoint.id ? { ...item, ...patch } : item) }
    : { ...current, exits: current.exits.map((item) => item.id === endpoint.id ? { ...item, ...patch } : item) }));
  const exit = kind === "exit" ? endpoint as WorldExit : null;
  const connection = exit?.connection;
  const gated = connection && connection.requiredTags.length + connection.blockedTags.length + connection.requiredAbilities.length > 0;
  const graphStyle: WorldExitGraphStyle = exit?.graphStyle ?? {
    color: !connection?.enabled ? "#566475" : gated ? "#d7b469" : "#729cba",
    lineStyle: !connection?.enabled || gated ? "dashed" : "solid",
  };
  const patchGraphStyle = (style: WorldExitGraphStyle | null) => {
    if (!exit) return;
    onChange(withRoom(world, room.id, current => ({ ...current, exits: current.exits.map(item => {
      if (item.id !== exit.id) return item;
      const updated = { ...item };
      if (style) updated.graphStyle = style;
      else delete updated.graphStyle;
      return updated;
    }) })));
  };
  const patchConnection = (patch: Partial<WorldExit["connection"]>) => {
    setError(null);
    onChange(withRoom(world, room.id, (current) => ({ ...current, exits: current.exits.map((item) => item.id === endpoint.id
      ? { ...item, connection: { ...item.connection, ...patch } } : item) })));
  };
  const connect = (targetRoomId: string, targetEntranceId: string) => {
    try { onChange(connectExit(world, room.id, endpoint.id, targetRoomId, targetEntranceId)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось соединить проход."); }
  };
  const sourceFor = (targetRoomId: string, targetEntranceId: string) => world.rooms.flatMap((owner) => owner.exits
    .filter((item) => item.connection.enabled && item.connection.targetRoomId === targetRoomId
      && item.connection.targetEntranceId === targetEntranceId && !(kind === "exit" && owner.id === room.id && item.id === endpoint.id))
    .map((item) => ({ room: owner, exit: item })))[0];
  const targetRoom = world.rooms.find((candidate) => candidate.id === connection?.targetRoomId);
  const incoming = kind === "entrance" ? sourceFor(room.id, endpoint.id) : undefined;
  return <>
    <button type="button" onClick={() => onSelect({ kind: "room", roomId: room.id })}>← {room.name}</button>
    <h2>{kind === "entrance" ? "Вход" : "Выход"}</h2>
    <TextField label="Название" value={endpoint.name} required onCommit={(name) => patchEndpoint({ name })} />
    {kind === "entrance" && <Section title="Связанный проход">
      {incoming ? <>
        <p>{incoming.room.name} · {incoming.exit.name}</p>
        <button type="button" onClick={() => onSelect({ kind: "exit", roomId: incoming.room.id, endpointId: incoming.exit.id })}>Настроить проход</button>
      </> : <p className="world-inspector-hint">Свободен. Соедините выход другой комнаты с этим входом.</p>}
      {world.start?.roomId === room.id && world.start.entranceId === endpoint.id && <p className="world-inspector-hint">Здесь начинается игра.</p>}
      <button type="button" onClick={() => onChange({ ...world, start: { roomId: room.id, entranceId: endpoint.id } })}>Начинать игру здесь</button>
    </Section>}
    {exit && <Advanced title="Оформление связи на карте">
      <div className="world-inspector-row">
        <label className="world-inspector-field"><span>Цвет линии</span>
          <input key={graphStyle.color} type="color" defaultValue={graphStyle.color}
            onBlur={event => {
              const color = event.currentTarget.value;
              if (color.toLowerCase() !== graphStyle.color.toLowerCase()) patchGraphStyle({ ...graphStyle, color });
            }}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === "Escape") { event.currentTarget.value = graphStyle.color; event.currentTarget.blur(); }
            }} />
        </label>
        <label className="world-inspector-field"><span>Начертание</span>
          <select value={graphStyle.lineStyle} onChange={event => patchGraphStyle({
            ...graphStyle, lineStyle: event.currentTarget.value as WorldExitGraphStyle["lineStyle"],
          })}>
            <option value="solid">Сплошная</option><option value="dashed">Пунктирная</option>
          </select>
        </label>
      </div>
      {exit.graphStyle && <button type="button" onClick={() => patchGraphStyle(null)}>Автоматический стиль</button>}
      <p className="world-inspector-hint">{exit.graphStyle ? "Оформление сохраняется при переподключении прохода." : "Сейчас цвет и начертание зависят от условий и состояния прохода."}</p>
    </Advanced>}
    {connection && <Section title="Проход в обе стороны">
      <label className="world-inspector-field"><span>Целевая комната</span>
        <select value={connection.targetRoomId ?? ""} onChange={(event) => patchConnection({
          targetRoomId: event.currentTarget.value || null, targetEntranceId: null, enabled: false,
        })}>
          <option value="">Не выбрана</option>
          {connection.targetRoomId && !targetRoom && <option value={connection.targetRoomId}>Комната не найдена</option>}
          {world.rooms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      {targetRoom && <label className="world-inspector-field"><span>Целевой вход</span>
        <select value={connection.targetEntranceId ?? ""} onChange={(event) => event.currentTarget.value
          ? connect(targetRoom.id, event.currentTarget.value)
          : patchConnection({ targetEntranceId: null, enabled: false })}>
          <option value="">Выберите вход</option>
          {connection.targetEntranceId && !targetRoom.entrances.some((item) => item.id === connection.targetEntranceId)
            && <option value={connection.targetEntranceId}>Вход не найден</option>}
          {targetRoom.entrances.map((candidate) => {
            const occupied = sourceFor(targetRoom.id, candidate.id);
            return <option key={candidate.id} value={candidate.id} disabled={!!occupied}>
              {candidate.name}{occupied ? ` — занят: ${occupied.room.name}` : ""}
            </option>;
          })}
        </select>
      </label>}
      {targetRoom && !targetRoom.entrances.length && <p className="world-inspector-hint">В целевой комнате нет входов. Добавьте вход в её свойствах.</p>}
      <CheckField label="Проход включён" checked={connection.enabled} onChange={(enabled) => {
        if (!enabled) patchConnection({ enabled: false });
        else if (connection.targetRoomId && connection.targetEntranceId) connect(connection.targetRoomId, connection.targetEntranceId);
        else setError("Сначала выберите целевую комнату и вход.");
      }} />
      {error && <p className="world-inspector-error" role="alert">{error}</p>}
      <label className="world-inspector-field"><span>Тип перехода</span>
        <select value={connection.type} onChange={(event) => patchConnection({ type: event.currentTarget.value as WorldExit["connection"]["type"] })}>
          {Object.entries(TRANSITION_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <Advanced title={`Условия и затемнение${gated ? " · есть ограничения" : ""}`}>
      <NumberField label="Затемнение и проявление, с" value={connection.fadeDuration} onCommit={(fadeDuration) => patchConnection({ fadeDuration })} />
      <TagsField label="Обязательные теги" values={connection.requiredTags} onCommit={(requiredTags) => patchConnection({ requiredTags })} />
      <TagsField label="Блокирующие теги" values={connection.blockedTags} onCommit={(blockedTags) => patchConnection({ blockedTags })} />
      <fieldset><legend>Нужные способности</legend>
        {(Object.entries(ABILITIES) as [Ability, string][]).map(([ability, label]) => <CheckField key={ability} label={label}
          checked={connection.requiredAbilities.includes(ability)} onChange={(checked) => patchConnection({
            requiredAbilities: checked ? [...connection.requiredAbilities, ability] : connection.requiredAbilities.filter((item) => item !== ability),
          })} />)}
      </fieldset>
      <p className="world-inspector-hint">Условия и затемнение действуют в обе стороны. «Граница» запускает переход при входе в объём.</p>
      </Advanced>
      {connection.targetRoomId && <button type="button" onClick={() => patchConnection({ enabled: false, targetRoomId: null, targetEntranceId: null })}>Отсоединить проход</button>}
    </Section>}
    <Advanced title="Прибытие и положение игрока">
      <CheckField label="Сохранять глубину игрока (Y)" checked={endpoint.preservePlayerDepth} onChange={(preservePlayerDepth) => patchEndpoint({ preservePlayerDepth })} />
      <CheckField label="Задать направление взгляда" checked={endpoint.overrideFacing} onChange={(overrideFacing) => patchEndpoint({ overrideFacing })} />
      {endpoint.overrideFacing && <label className="world-inspector-field"><span>Смотреть</span>
        <select value={endpoint.faceRight ? "right" : "left"} onChange={(event) => patchEndpoint({ faceRight: event.currentTarget.value === "right" })}>
          <option value="right">Вправо</option><option value="left">Влево</option>
        </select>
      </label>}
      <NumberField label="Допустимая коррекция позиции, см" value={endpoint.maximumPlacementAdjustmentCm}
        onCommit={(maximumPlacementAdjustmentCm) => patchEndpoint({ maximumPlacementAdjustmentCm })} />
    </Advanced>
    <Identity id={endpoint.id} />
    <button type="button" className="world-inspector-danger" onClick={() => {
      onChange(removeEndpoint(world, room.id, kind, endpoint.id)); onSelect({ kind: "room", roomId: room.id });
    }}>Удалить {kind === "entrance" ? "вход" : "выход"}</button>
  </>;
}

export default function WorldInspector({ world, selection, onChange, onSelect, shapes, onOpenBlockout, onDeleteRoom, blockingSettings, renderRoomBlocking }: InspectorProps) {
  const selectedRoom = "roomId" in selection ? world.rooms.find((room) => room.id === selection.roomId) : undefined;
  let content: ReactNode;
  if (selection.kind === "start") {
    content = <StartInspector world={world} onChange={onChange} onSelect={onSelect} />;
  } else if ((selection.kind === "entrance" || selection.kind === "exit") && selectedRoom) {
    const endpoint = (selection.kind === "entrance" ? selectedRoom.entrances : selectedRoom.exits).find((item) => item.id === selection.endpointId);
    content = endpoint ? <EndpointInspector key={`${selection.kind}:${selectedRoom.id}:${endpoint.id}`} world={world} room={selectedRoom}
      endpoint={endpoint} kind={selection.kind} onChange={onChange} onSelect={onSelect} />
      : <p className="world-inspector-hint">Вход или выход удалён. Выберите другой объект.</p>;
  } else if (selection.kind === "region") {
    const region = world.regions.find((item) => item.id === selection.regionId);
    const patch = (changes: Partial<WorldData["regions"][number]>) => region && onChange({ ...world,
      regions: world.regions.map((item) => item.id === region.id ? { ...item, ...changes } : item) });
    content = region ? <>
      <h2>Регион</h2>
      <TextField label="Название" value={region.name} required onCommit={(name) => patch({ name })} />
      <TextField label="Описание" value={region.description} multiline onCommit={(description) => patch({ description })} />
      <label className="world-inspector-field"><span>Цвет региона</span><input key={region.color} type="color" defaultValue={region.color}
        onBlur={(event) => { if (event.currentTarget.value !== region.color) patch({ color: event.currentTarget.value }); }} /></label>
      <p className="world-inspector-hint">Комнат: {world.rooms.filter((room) => room.regionId === region.id).length}. Область региона охватывает их автоматически.</p>
      <Identity id={region.id} />
      <button type="button" className="world-inspector-danger" onClick={() => { onChange(removeRegion(world, region.id)); onSelect({ kind: "world" }); }}>Убрать регион</button>
      <p className="world-inspector-hint">Комнаты останутся в мире без региона.</p>
    </> : <p className="world-inspector-hint">Регион удалён. Выберите другой объект.</p>;
  } else if (selection.kind === "room" && selectedRoom) {
    const room = selectedRoom;
    const patch = (changes: Partial<WorldRoom>) => onChange(withRoom(world, room.id, (current) => ({ ...current, ...changes })));
    const shape = shapes.find((item) => item.id === room.shapeItemId);
    content = <>
      <h2>Комната</h2>
      <TextField label="Название" value={room.name} required onCommit={(name) => patch({ name })} />
      <TextField label="Описание и задачи" value={room.description} multiline onCommit={(description) => patch({ description })} />
      <label className="world-inspector-field"><span>Регион</span><select value={room.regionId ?? ""}
        onChange={(event) => patch({ regionId: event.currentTarget.value || null })}>
        <option value="">Без региона</option>
        {room.regionId && !world.regions.some((item) => item.id === room.regionId) && <option value={room.regionId}>Регион не найден</option>}
        {world.regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="world-inspector-row">
        <label className="world-inspector-field"><span>Тип комнаты</span><select value={room.roomType}
          onChange={(event) => patch({ roomType: event.currentTarget.value as WorldRoom["roomType"] })}>
          {Object.entries(ROOM_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="world-inspector-field"><span>Готовность</span><select value={room.status}
          onChange={(event) => patch({ status: event.currentTarget.value as WorldRoom["status"] })}>
          {Object.entries(ROOM_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <button type="button" className="world-inspector-primary" onClick={() => onOpenBlockout(room.id)}>Открыть комнату →</button>
      <Section title="Входы и выходы">
        {room.entrances.map((endpoint) => <button type="button" key={endpoint.id}
          onClick={() => onSelect({ kind: "entrance", roomId: room.id, endpointId: endpoint.id })}>Вход · {endpoint.name}</button>)}
        {room.exits.map((endpoint) => <button type="button" key={endpoint.id}
          onClick={() => onSelect({ kind: "exit", roomId: room.id, endpointId: endpoint.id })}>Выход · {endpoint.name}{endpoint.connection.enabled ? " ↔" : ""}</button>)}
        <div className="world-inspector-actions">
          <button type="button" onClick={() => {
            const endpoint = createEntrance(`Вход ${room.entrances.length + 1}`);
            patch({ entrances: [...room.entrances, endpoint] }); onSelect({ kind: "entrance", roomId: room.id, endpointId: endpoint.id });
          }}>+ Вход</button>
          <button type="button" onClick={() => {
            const endpoint = createExit(`Выход ${room.exits.length + 1}`);
            patch({ exits: [...room.exits, endpoint] }); onSelect({ kind: "exit", roomId: room.id, endpointId: endpoint.id });
          }}>+ Выход</button>
        </div>
        <Advanced title="Как добавлять переходы">
          <p className="world-inspector-hint">Выход соединяется со входом; проход работает в обе стороны. Точки из блокинга появляются здесь автоматически: используйте объект «Переход» или назначьте вход/выход стороне «Дверь/Проход». Кнопки выше добавляют отдельные точки вручную.</p>
        </Advanced>
      </Section>
      {room.shapeItemId && !shape && <p className="world-inspector-error" role="alert">Привязанный контур не найден. Выберите другой в разделе «Размер, контур и координаты».</p>}
      {!room.blockingOrigin && <p className="world-inspector-warning">Начало координат блокинга не задано. Настройте его в разделе «Размер, контур и координаты» перед импортом.</p>}
      <Advanced title="Размер, контур и координаты">
      <Section title="Размер и блокинг">
        <div className="world-inspector-row">
          <NumberField label="Ширина X, см" value={room.designSizeCm.x} min={1} onCommit={(x) => patch({ designSizeCm: { ...room.designSizeCm, x } })} />
          <NumberField label="Высота Z, см" value={room.designSizeCm.z} min={1} onCommit={(z) => patch({ designSizeCm: { ...room.designSizeCm, z } })} />
        </div>
        <p className="world-inspector-hint">Плановый размер. Геометрия задаётся контуром и масштабом клетки; положение карточки её не меняет.</p>
        <label className="world-inspector-field"><span>Контур в блокинге</span><select value={room.shapeItemId ?? ""}
          onChange={(event) => patch({ shapeItemId: event.currentTarget.value || undefined })}>
          <option value="">Не привязан</option>
          {room.shapeItemId && !shape && <option value={room.shapeItemId}>Контур не найден</option>}
          {shapes.map((item) => {
            const owner = world.rooms.find((candidate) => candidate.id !== room.id && candidate.shapeItemId === item.id);
            return <option key={item.id} value={item.id} disabled={!!owner}>{item.label}{owner ? ` — ${owner.name}` : ""}</option>;
          })}
        </select></label>
      </Section>
      {renderRoomBlocking?.(room.id)}
      </Advanced>
      <Advanced title={`Метки${room.tags.length + room.environmentTags.length ? ` · ${room.tags.length + room.environmentTags.length}` : ""}`}>
        <TagsField label="Теги комнаты" values={room.tags} onCommit={(tags) => patch({ tags })} />
        <TagsField label="Теги окружения" values={room.environmentTags} onCommit={(environmentTags) => patch({ environmentTags })} />
      </Advanced>
      <Identity id={room.id} />
      <button type="button" className="world-inspector-danger" onClick={() => onDeleteRoom(room.id)}>Удалить комнату из мира · Del</button>
      <p className="world-inspector-hint">Удаление можно отменить. Контур и объекты останутся; перед импортом назначьте им другую комнату.</p>
    </>;
  } else {
    const patchSettings = (changes: Partial<WorldData["settings"]>) => onChange({ ...world, settings: { ...world.settings, ...changes } });
    content = <>
      <h2>Свойства мира</h2>
      <p className="world-inspector-hint">{world.regions.length} регионов · {world.rooms.length} комнат</p>
      <button type="button" onClick={() => onSelect({ kind: "start" })}>Настроить начало игры</button>
      <Advanced title="Настройки для Unreal">
        <TextField label="Каталог новых ассетов" value={world.settings.assetFolder} placeholder="/Game/Worlds" required
          onCommit={(assetFolder) => patchSettings({ assetFolder })} />
        <NumberField label="Ожидание перехода, с" value={world.settings.transitionTimeout} min={5}
          onCommit={(transitionTimeout) => patchSettings({ transitionTimeout })} />
        <CheckField label="Использовать граф для карты игрока" checked={world.settings.useRoomGraphForPlayerMap}
          onChange={(useRoomGraphForPlayerMap) => patchSettings({ useRoomGraphForPlayerMap })} />
        <p className="world-inspector-hint">Настройки передаются через «Экспорт». Папка первого импорта выбирается в движке.</p>
      </Advanced>
      {blockingSettings && <Advanced title="Масштаб и геометрия">{blockingSettings}</Advanced>}
      <Identity id={world.id} />
    </>;
  }
  return <aside className="world-inspector" aria-label="Свойства выбранного объекта">{content}</aside>;
}
