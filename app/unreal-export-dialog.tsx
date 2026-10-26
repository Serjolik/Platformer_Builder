"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapDocument } from "./map-document";
import { buildUnrealExport, defaultUnrealExportOptions, getUnrealExportCategory, type UnrealExportDocument, type UnrealExportOptions } from "./unreal-export";
import "./unreal-export-dialog.css";

type UnrealExportDialogProps = {
  document: MapDocument;
  onClose: () => void;
  onExport: (document: MapDocument | UnrealExportDocument, filenameSuffix?: string) => void;
};

export default function UnrealExportDialog({ document: sourceDocument, onClose, onExport }: UnrealExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [exportType, setExportType] = useState<"unreal" | "project">("unreal");
  const [options, setOptions] = useState<UnrealExportOptions>(defaultUnrealExportOptions);
  const [downloadError, setDownloadError] = useState("");
  const review = useMemo(() => exportType === "unreal" ? buildUnrealExport(sourceDocument, options) : null, [sourceDocument, options, exportType]);
  const counts = useMemo(() => {
    const result = { roomContours: 0, geometry: 0, objects: 0, enemies: 0 };
    for (const item of sourceDocument.items) {
      const category = getUnrealExportCategory(item);
      if (category) result[category] += 1;
    }
    return result;
  }, [sourceDocument.items]);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const patchOptions = (changes: Partial<UnrealExportOptions>) => {
    setOptions(current => ({ ...current, ...changes }));
    setDownloadError("");
  };
  const geometryMode = options.geometry ? "all" : options.roomContours ? "contours" : "none";
  const errors = review?.errors ?? [];
  const warnings = review?.warnings ?? [];
  const exportDocument = exportType === "project" ? sourceDocument : review?.document;
  const suffix = exportType === "unreal" ? "-unreal" : "";
  const filename = `${sourceDocument.name || "location"}${suffix}.json`;
  return <dialog ref={dialogRef} className="unreal-export-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="unreal-export-heading">
      <div><h2 id={headingId}>Экспорт</h2><p>{sourceDocument.name || "Новый мир"}</p></div>
      <button type="button" className="unreal-export-close" aria-label="Закрыть экспорт" onClick={onClose}>×</button>
    </div>
    <div className="unreal-export-body">
      <label className="unreal-export-field"><span>Тип экспорта</span><select value={exportType} onChange={event => {
        setExportType(event.currentTarget.value as "unreal" | "project");
        setDownloadError("");
      }}>
        <option value="unreal">Для Unreal</option>
        <option value="project">Полный проект</option>
      </select></label>
      {exportType === "unreal" ? <>
        <p className="unreal-export-catalog">Каталог мира и постоянные ID передаются всегда. <b>Регионы: {sourceDocument.world.regions.length} · Комнаты: {sourceDocument.world.rooms.length}</b>.</p>
        <label className="unreal-export-field"><span>Геометрия</span><select value={geometryMode} onChange={event => patchOptions({
          roomContours: event.currentTarget.value !== "none", geometry: event.currentTarget.value === "all",
        })}>
          <option value="none">Без геометрии</option>
          <option value="contours">Только контуры комнат</option>
          <option value="all">Вся геометрия</option>
        </select></label>
        <p className="unreal-export-selection-hint">{geometryMode === "none" ? "Существующая геометрия в Unreal сохранится."
          : `Контуры: ${options.roomContours ? counts.roomContours : 0}${options.geometry ? ` · Блоки: ${counts.geometry}` : ""}. Масштаб и начало координат берутся из проекта.`}</p>
        <div className="unreal-export-options">
          <label title="Входы, выходы, соединения, условия и точка старта"><input type="checkbox" checked={options.logic} onChange={event => patchOptions({ logic: event.currentTarget.checked })} /><span>Переходы и условия</span></label>
          <label title="Объекты в режиме Blueprint, кроме врагов и боссов"><input type="checkbox" checked={options.objects} onChange={event => patchOptions({ objects: event.currentTarget.checked })} /><span>Объекты Blueprint</span><small aria-hidden="true">{counts.objects}</small></label>
          <label title="Враги и боссы в режиме Blueprint"><input type="checkbox" checked={options.enemies} onChange={event => patchOptions({ enemies: event.currentTarget.checked })} /><span>Противники</span><small aria-hidden="true">{counts.enemies}</small></label>
        </div>
        <p className="unreal-export-scope-hint">Классы Blueprint выбираются в Unreal. Ключи, урон и настройки ИИ не передаются. Выключенные категории сохраняются в движке.</p>
      </> : <div className="unreal-export-project-info">
        <strong>Весь проект без исключений</strong>
        <p>Мир, рисунок, слои и все настройки. Этот JSON можно снова открыть в конструкторе через «Импорт».</p>
        <small>{sourceDocument.items.length} объектов · {sourceDocument.world.rooms.length} комнат</small>
      </div>}
      {errors.length > 0 && <section className="unreal-export-errors" aria-label="Ошибки экспорта">
        <h3>Нужно исправить · {errors.length}</h3>
        <ul>{errors.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
      </section>}
      {warnings.length > 0 && <details className="unreal-export-warnings">
        <summary>Замечания · {warnings.length}</summary>
        <ul>{warnings.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
      </details>}
      {downloadError && <p role="alert" className="unreal-export-error-text">{downloadError}</p>}
    </div>
    <div className="unreal-export-actions">
      <span title={filename}>{filename}</span>
      <button type="button" onClick={onClose}>Отмена</button>
      <button type="button" className="unreal-export-download" disabled={!exportDocument || errors.length > 0} onClick={() => {
        if (!exportDocument || errors.length) return;
        try { onExport(exportDocument, suffix); onClose(); }
        catch (error) { setDownloadError(error instanceof Error ? error.message : "Не удалось скачать JSON."); }
      }}>Скачать файл</button>
    </div>
  </dialog>;
}
