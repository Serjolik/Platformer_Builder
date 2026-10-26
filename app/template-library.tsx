"use client";

import { useEffect, useRef, useState } from "react";
import { CELL, getMovingPlatformLayout, type MapDocument } from "./map-document";
import { createTemplate, mergeTemplateLibraries, parseTemplateLibrary, serializeTemplateLibrary, TEMPLATE_STORAGE_KEY, templateSelection, type ObjectTemplate } from "./template-model";
import "./template-library.css";

function TemplatePreview({ template }: { template: ObjectTemplate }) {
  const pad = Math.max(12, Math.max(template.width, template.height) * .06);
  return <svg className="template-preview" aria-hidden="true" viewBox={`${-pad} ${-pad} ${template.width + pad * 2} ${template.height + pad * 2}`}>
    {template.items.map((item, index) => {
      const layout = item.kind === "moving" ? getMovingPlatformLayout(item) : null;
      return <g key={index} fill={item.color} stroke={item.color} strokeWidth="2" vectorEffect="non-scaling-stroke">
        {layout ? <><line x1={layout.start.x} y1={layout.start.y} x2={layout.end.x} y2={layout.end.y} strokeDasharray="6 5" /><rect {...layout.platformBounds} fillOpacity=".55" /></>
          : item.polygonPoints ? <polygon points={item.polygonPoints.map(point => `${point.x + item.x},${point.y + item.y}`).join(" ")} fillOpacity=".25" />
          : <rect x={item.x} y={item.y} width={item.w * CELL} height={item.h * CELL} rx={item.kind === "enemy" || item.kind === "npc" ? 12 : 1} fillOpacity={item.kind === "platform" ? .45 : .2} />}
        {item.platformMode === "oneway" && <line x1={item.x} y1={item.y} x2={item.x + item.w * CELL} y2={item.y} strokeWidth="5" />}
      </g>;
    })}
  </svg>;
}

function downloadLibrary(templates: ObjectTemplate[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(serializeTemplateLibrary(templates), null, 2)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = "Мои заготовки — MapConstructor.json"; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TemplateLibrary({ document, selectedIds, onInsert, disabled = false }: {
  document: MapDocument; selectedIds: string[]; onInsert: (template: ObjectTemplate) => void; disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<ObjectTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleted, setDeleted] = useState<ObjectTemplate | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = templateSelection(document, selectedIds);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (raw) setTemplates(parseTemplateLibrary(JSON.parse(raw)));
    } catch (error) {
      setStorageBlocked(true);
      setStorageError(`Не удалось прочитать библиотеку: ${error instanceof Error ? error.message : "хранилище недоступно"} Существующая запись сохранена. Исправьте доступ к хранилищу и обновите страницу.`);
    }
    setLoaded(true);
  }, []);

  const persist = (next: ObjectTemplate[]): boolean => {
    if (storageBlocked || !loaded) return false;
    setTemplates(next);
    try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(serializeTemplateLibrary(next))); setStorageError(""); }
    catch { setStorageError("Изменения библиотеки пока только в памяти: браузер не разрешил сохранение. Экспортируйте библиотеку перед закрытием страницы."); }
    return true;
  };
  const add = () => {
    try {
      const template = createTemplate(document, selectedIds, name || (selected.length === 1 ? selected[0].label : "Моя заготовка"));
      const next = mergeTemplateLibraries(templates, [template]);
      if (persist(next)) { setName(""); setMessage(`Сохранено: «${template.name}», объектов: ${template.items.length}.`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось создать заготовку."); }
  };
  const rename = () => {
    try {
      const next = parseTemplateLibrary(serializeTemplateLibrary(templates.map(template => template.id === renamingId ? { ...template, name: renameValue } : template)));
      if (persist(next)) { setRenamingId(null); setMessage("Название изменено."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось переименовать заготовку."); }
  };
  const importLibrary = async (file: File) => {
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Файл библиотеки слишком большой (максимум 8 МБ).");
      const imported = parseTemplateLibrary(JSON.parse(await file.text()));
      const next = mergeTemplateLibraries(templates, imported);
      if (persist(next)) setMessage(`Импортировано заготовок: ${imported.length}. Совпадающие записи обновлены.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось импортировать библиотеку."); }
  };

  return <details className="template-library" open onKeyDown={event => event.stopPropagation()}>
    <summary>Мои заготовки <span>{templates.length}</span></summary>
    <div className="template-library-body">
      <p className="template-help">Выделите объекты и сохраните их как заготовку. Комнаты, переходы и разметка маршрутов не копируются. Вставка назначает объекты текущей комнате и слою.</p>
      <div className="template-create">
        <label>Название заготовки<input value={name} maxLength={80} placeholder={selected.length === 1 ? selected[0].label : "Например, секретная ниша"} onChange={event => setName(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (selected.length && !disabled) add(); } }} /></label>
        <button type="button" disabled={!loaded || storageBlocked || disabled || !selected.length} onClick={add}>Сохранить выделение{selected.length ? ` (${selected.length})` : ""}</button>
      </div>
      {selectedIds.length > selected.length && <p className="template-help">Часть выделения не входит в заготовку: контуры, переходы или разметка.</p>}
      <div className="template-library-files">
        <button type="button" disabled={!templates.length} onClick={() => downloadLibrary(templates)}>Экспорт библиотеки</button>
        <button type="button" disabled={!loaded || storageBlocked} title="Добавляет заготовки из файла. Совпадающие ID обновляются." onClick={() => inputRef.current?.click()}>Импорт библиотеки</button>
        <input ref={inputRef} type="file" accept="application/json,.json" aria-label="Файл библиотеки заготовок" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importLibrary(file); event.currentTarget.value = ""; }} />
      </div>
      <p className="template-help">Библиотека общая для проектов в этом браузере. Для переноса сохраните отдельный файл.</p>
      {storageError && <p className="template-message is-error" role="alert">{storageError}</p>}
      {message && <p className="template-message" role="status">{message}</p>}
      {deleted && <button type="button" className="template-restore" disabled={storageBlocked} onClick={() => { try { if (persist(mergeTemplateLibraries(templates, [deleted]))) { setDeleted(null); setMessage("Заготовка восстановлена."); } } catch (error) { setMessage(String(error)); } }}>Вернуть «{deleted.name}»</button>}
      {templates.length > 4 && <input className="template-search" type="search" aria-label="Поиск заготовок" placeholder="Найти заготовку…" value={filter} onChange={event => setFilter(event.currentTarget.value)} />}
      <div className="template-list">
        {templates.filter(template => template.name.toLocaleLowerCase("ru").includes(filter.toLocaleLowerCase("ru"))).map(template => <article className="template-card" key={template.id}>
          <TemplatePreview template={template} />
          {renamingId === template.id ? <div className="template-rename"><input aria-label="Новое название заготовки" maxLength={80} value={renameValue} onChange={event => setRenameValue(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); rename(); } if (event.key === "Escape") setRenamingId(null); }} /><button type="button" onClick={rename}>Готово</button><button type="button" onClick={() => setRenamingId(null)}>Отмена</button></div>
            : <b className="template-name" title={template.name}>{template.name}</b>}
          <span className="template-meta">{template.items.length} объектов · {(template.width / CELL).toLocaleString("ru", { maximumFractionDigits: 1 })} × {(template.height / CELL).toLocaleString("ru", { maximumFractionDigits: 1 })} кл.</span>
          <button type="button" className="template-insert" disabled={disabled} aria-label={`Вставить заготовку ${template.name}`} onClick={() => { onInsert(template); setMessage(`Вставлено: «${template.name}». Объекты выделены — их можно переместить вместе.`); }}>Вставить</button>
          <div className="template-card-actions"><button type="button" disabled={storageBlocked} onClick={() => { setRenamingId(template.id); setRenameValue(template.name); }}>Название</button><button type="button" disabled={storageBlocked} aria-label={`Удалить заготовку ${template.name}`} onClick={() => { if (persist(templates.filter(entry => entry.id !== template.id))) { setDeleted(template); setMessage(`Заготовка «${template.name}» удалена из библиотеки.`); } }}>Удалить</button></div>
        </article>)}
      </div>
      {!templates.length && !storageBlocked && <p className="template-help">Здесь появятся ваши наборы платформ, ловушек, врагов и других объектов.</p>}
    </div>
  </details>;
}
