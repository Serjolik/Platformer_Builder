"use client";

import { useState } from "react";
import { getItemBlocking } from "./blocking-model";
import type { MapDocument, PlacedItem } from "./map-document";
import { assignRoomTransition, getRoomTransitionOwner, removeRoomTransition } from "./room-transitions";
import "./transition-inspector.css";

export type TransitionInspectorProps = {
  document: MapDocument;
  onChange: (document: MapDocument) => void;
  itemId: string;
  sideIndex?: number;
};

const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function TransitionFields({ document, onChange, item, sideIndex }: Omit<TransitionInspectorProps, "itemId"> & { item: PlacedItem }) {
  const [error, setError] = useState("");
  const isSide = sideIndex !== undefined;
  const sideType = isSide ? item.sideTypes?.[sideIndex] ?? "straight" : null;
  const sideAllowed = !isSide || sideType === "door" || sideType === "opening";
  const binding = isSide ? item.sideTransitions?.[sideIndex] : item.transition;
  const room = getRoomTransitionOwner(document, item);
  const endpoint = binding && room ? (binding.kind === "entrance" ? room.entrances : room.exits)
    .find(candidate => sameId(candidate.id, binding.endpointId)) : undefined;
  const name = isSide ? endpoint?.name ?? "" : item.label;
  const run = (update: () => MapDocument) => {
    try {
      const next = update();
      if (next !== document) onChange(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось изменить точку перехода.");
    }
  };
  const rename = (value: string) => {
    if (!value || value === name) return;
    run(() => ({
      ...document,
      items: isSide ? document.items : document.items.map(candidate => candidate.id === item.id ? { ...candidate, label: value } : candidate),
      world: !binding || !room || !endpoint ? document.world : {
        ...document.world,
        rooms: document.world.rooms.map(candidate => !sameId(candidate.id, room.id) ? candidate : binding.kind === "entrance"
          ? { ...candidate, entrances: candidate.entrances.map(point => sameId(point.id, binding.endpointId) ? { ...point, name: value } : point) }
          : { ...candidate, exits: candidate.exits.map(point => sameId(point.id, binding.endpointId) ? { ...point, name: value } : point) }),
      },
    }));
  };

  return <section className="transition-inspector" aria-label={isSide ? `Переход на стороне ${sideIndex + 1}` : "Точка перехода"}>
    <h3>{isSide ? "Переход на стороне" : "Точка перехода"}</h3>
    {isSide ? <div className="transition-owner"><span>Комната мира</span><b>{room?.name ?? "Не назначена"}</b></div>
      : <label className="transition-field"><span>Комната мира</span><select value={room?.id ?? item.blocking?.roomId ?? ""}
        onChange={event => {
          const roomId = event.currentTarget.value || null;
          run(() => ({ ...document, items: document.items.map(candidate => candidate.id === item.id
            ? { ...candidate, blocking: { ...getItemBlocking(candidate), roomId, mode: "none" } } : candidate) }));
        }}>
        <option value="">Не назначена</option>
        {item.blocking?.roomId && !room && <option value={item.blocking.roomId}>Комната не найдена</option>}
        {document.world.rooms.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name || "Без названия"}</option>)}
      </select></label>}
    <label className="transition-field"><span>Роль в графе мира</span><select value={binding?.kind ?? "none"} disabled={!room || !sideAllowed}
      onChange={event => {
        const kind = event.currentTarget.value as "none" | "entrance" | "exit";
        if (kind === (binding?.kind ?? "none")) return;
        run(() => kind === "none" ? removeRoomTransition(document, item.id, sideIndex)
          : assignRoomTransition(document, item.id, kind, sideIndex));
      }}>
      <option value="none">Без назначения</option>
      <option value="entrance">Вход</option>
      <option value="exit">Выход</option>
    </select></label>
    {(!isSide || endpoint) && <label className="transition-field"><span>Название точки</span><input key={name} type="text" defaultValue={name}
      placeholder={binding?.kind === "entrance" ? "Вход" : binding?.kind === "exit" ? "Выход" : "Переход"}
      onBlur={event => {
        const value = event.currentTarget.value.trim();
        if (!value) { event.currentTarget.value = name; return; }
        rename(value);
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.currentTarget.value = name; event.currentTarget.blur(); }
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      }} /></label>}
    {!sideAllowed ? <p className="transition-hint">Назначение доступно для сторон «Дверь» и «Проход». Сначала выберите один из этих типов стороны.</p>
      : !room ? <p className="transition-warning">{isSide ? "Назначьте контур комнате мира, чтобы создать на этой стороне вход или выход." : "Выберите комнату, затем роль. Точка появится на её карточке в графе мира."}</p>
        : !binding ? <p className="transition-hint">{isSide ? "Тип стороны задаёт проём. Вход или выход появится в графе только после выбора роли." : "Вход принимает проход из другой комнаты. Из выхода протягивается связь к нужному входу."}</p>
          : !endpoint ? <p className="transition-warning">Связанная точка не найдена в графе. Снимите назначение и выберите роль заново.</p>
            : <p className="transition-hint">{binding.kind === "entrance" ? "Этот вход уже отображается на карточке комнаты. К нему можно подключить выход другой комнаты." : "Этот выход уже отображается на карточке комнаты. Соедините его со входом нужной комнаты."}</p>}
    {binding && <>
      <button type="button" className="transition-unbind" onClick={() => run(() => removeRoomTransition(document, item.id, sideIndex))}>Снять назначение</button>
      <p className="transition-hint">Смена роли или снятие назначения уберёт прежние связи этой точки.</p>
    </>}
    {error && <p className="transition-error" role="alert">{error}</p>}
  </section>;
}

export function TransitionInspector({ document, itemId, sideIndex, onChange }: TransitionInspectorProps) {
  const item = document.items.find(candidate => candidate.id === itemId);
  if (!item || (sideIndex === undefined ? item.kind !== "transition" : item.kind !== "room")) return null;
  if (sideIndex !== undefined && (!Number.isInteger(sideIndex) || sideIndex < 0 || sideIndex >= (item.polygonPoints?.length ?? 4))) return null;
  return <TransitionFields key={`${itemId}/${sideIndex ?? "marker"}`} document={document} onChange={onChange} item={item} sideIndex={sideIndex} />;
}

export default TransitionInspector;
