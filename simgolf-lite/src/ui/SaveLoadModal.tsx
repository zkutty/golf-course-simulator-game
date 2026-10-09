import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatCurrency, formatDateTime, formatWeekLabel } from "../i18n/format";
import type { SavePayload } from "../utils/save";
import {
  deleteSlot,
  exportSlot,
  importSaveResult,
  listSlots,
  loadSlotResult,
  renameSlot,
  saveToSlot,
  subscribeToSaveSlots,
  type SaveSlotMeta,
} from "../utils/saveStore";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import { T } from "../i18n/T";
import { IconUi } from "../assets/icons/IconUi";
import "./SaveLoadModal.css";
import { useI18n } from "../i18n/useI18n";

/**
 * Save/Load slot manager (ZKU-174). Opened from the in-game Save/Load
 * buttons (canSave) and from the start menu's Load Game (load-only).
 */

export interface SaveLoadModalProps {
  open: boolean;
  onClose: () => void;
  canSave: boolean;
  getPayload?: () => SavePayload;
  onLoaded: (payload: SavePayload) => void;
  onSaved?: () => void;
}

const PROFILE_KEYS = { relaxed: "newGame.experience.profile.relaxed.label", classic: "newGame.experience.profile.classic.label", simulation: "newGame.experience.profile.simulation.label" } as const;
const PRESSURE_KEYS = { friendly: "newGame.pressure.friendly.label", balanced: "newGame.pressure.balanced.label", tight: "newGame.pressure.tight.label" } as const;
const THEME_KEYS = { parkland: "vision.biome.parkland.title", links: "vision.biome.links.title", desert: "vision.biome.desert.title" } as const;
const DIFFICULTY_KEYS = { easy: "save.difficulty.easy", normal: "save.difficulty.normal", hard: "save.difficulty.hard" } as const;
const KIND_KEYS = { manual: "save.kind.manual", auto: "save.kind.auto", quick: "save.kind.quick" } as const;

export function SaveLoadModal(props: SaveLoadModalProps) {
  const { t, locale } = useI18n();
  const id = useId();
  const [slots, setSlots] = useState<SaveSlotMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(props.open, props.onClose);

  const refresh = useCallback(() => {
    void listSlots().then(setSlots);
  }, []);

  // Reset transient UI on open via render adjustment (not an effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) {
      setNotice(null);
      setConfirmDeleteId(null);
    }
  }

  useEffect(() => {
    if (props.open) refresh(); // async slot fetch → setState after await is fine
  }, [props.open, refresh]);

  useEffect(() => subscribeToSaveSlots(() => {
    if (props.open) refresh();
  }), [props.open, refresh]);

  if (!props.open) return null;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  const handleSaveNew = async () => {
    if (!props.getPayload) return;
    const name = newName.trim() || t("save.defaultName", { week: formatWeekLabel(props.getPayload().world.week, locale, "week") });
    await saveToSlot(null, "manual", name, props.getPayload());
    props.onSaved?.();
    setNewName("");
    flash(t("save.saved"));
    refresh();
  };

  const handleOverwrite = async (slot: SaveSlotMeta) => {
    if (!props.getPayload) return;
    await saveToSlot(slot.id, slot.kind, slot.name, props.getPayload());
    props.onSaved?.();
    flash(t("save.overwritten", { name: slot.name }));
    refresh();
  };

  const handleLoad = async (slot: SaveSlotMeta) => {
    const result = await loadSlotResult(slot.id);
    if (!result.ok) {
      flash(result.error.message);
      refresh();
      return;
    }
    props.onLoaded(result.payload);
    props.onClose();
  };

  const handleDelete = async (slot: SaveSlotMeta) => {
    if (confirmDeleteId !== slot.id) {
      setConfirmDeleteId(slot.id);
      return;
    }
    await deleteSlot(slot.id);
    setConfirmDeleteId(null);
    flash(t("save.deleted", { name: slot.name }));
    refresh();
  };

  const handleRename = async (slot: SaveSlotMeta) => {
    const name = window.prompt(t("save.renamePrompt"), slot.name);
    if (!name || !name.trim()) return;
    await renameSlot(slot.id, name.trim());
    refresh();
  };

  const handleExport = async (slot: SaveSlotMeta) => {
    const text = await exportSlot(slot.id);
    if (!text) return;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slot.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "save"}.coursecraft`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const result = await importSaveResult(text, file.name.replace(/\.coursecraft$|\.json$/i, ""));
    if (!result.ok) {
      flash(result.error.message);
      return;
    }
    flash(result.migratedFrom ? t("save.importedUpgraded", { name: result.meta.name, version: result.migratedFrom }) : t("save.imported", { name: result.meta.name }));
    refresh();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t(props.canSave ? "save.dialog" : "save.loadDialog")} className="cc-save-load-overlay" data-testid="save-load-screen" onClick={props.onClose}>
      <div ref={trapRef} className="cc-save-load-panel" onClick={(event) => event.stopPropagation()}>
        <header className="cc-save-load-header">
          <IconUi name="records" size={28} />
          <h2>{t(props.canSave ? "save.title" : "save.loadTitle")}</h2>
        </header>
        <div role="status" aria-live="polite" aria-atomic="true" className="cc-save-load-notice">{notice}</div>

        {props.canSave && (
          <div className="cc-save-load-new">
            <label htmlFor={`${id}-new-name`}>{t("save.newNameLabel")}</label>
            <div className="cc-save-load-new-controls">
              <input id={`${id}-new-name`} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t("auto.ui.saveloadmodal.new.save.name")} />
              <button className="cc-save-load-primary" onClick={() => void handleSaveNew()}><T id="auto.ui.saveloadmodal.save.to.new.slot" /></button>
            </div>
          </div>
        )}

        {slots.length === 0 && <p className="cc-save-load-empty">{t(props.canSave ? "save.empty.canSave" : "save.empty.loadOnly")}</p>}

        <div className="cc-save-load-slots">
          {slots.map((slot) => (
            <section key={slot.id} data-testid={`save-slot-${slot.id}`} className="cc-save-load-slot" aria-labelledby={`${id}-${slot.id}-title`}>
              <div className="cc-save-load-slot-heading">
                <h3 id={`${id}-${slot.id}-title`}>{slot.name}</h3>
                <span className="cc-save-load-kind">{t(KIND_KEYS[slot.kind])}</span>
              </div>
              <p className="cc-save-load-summary">
                {slot.courseName} • {formatWeekLabel(slot.week, locale, "week")} • {formatCurrency(slot.cash, locale)} • {t("save.holes", { count: slot.holesOpen })}{slot.experienceProfile || slot.economicPressure ? ` • ${(PROFILE_KEYS[slot.experienceProfile ?? "classic"] ? t(PROFILE_KEYS[slot.experienceProfile ?? "classic"]) : slot.experienceProfile)}/${(PRESSURE_KEYS[slot.economicPressure ?? "balanced"] ? t(PRESSURE_KEYS[slot.economicPressure ?? "balanced"]) : slot.economicPressure)}` : slot.difficulty ? ` • ${DIFFICULTY_KEYS[slot.difficulty] ? t(DIFFICULTY_KEYS[slot.difficulty]) : slot.difficulty}` : ""}
                {slot.theme ? ` • ${(THEME_KEYS[slot.theme] ? t(THEME_KEYS[slot.theme]) : slot.theme)}` : ""} • {formatDateTime(slot.savedAt, locale)}
              </p>
              <div className="cc-save-load-actions">
                <button aria-describedby={`${id}-${slot.id}-title`} onClick={() => void handleLoad(slot)}><T id="auto.ui.saveloadmodal.load" /></button>
                {props.canSave && <button aria-describedby={`${id}-${slot.id}-title`} onClick={() => void handleOverwrite(slot)}><T id="auto.ui.saveloadmodal.overwrite" /></button>}
                <button aria-describedby={`${id}-${slot.id}-title`} onClick={() => void handleRename(slot)}><T id="auto.ui.saveloadmodal.rename" /></button>
                <button aria-describedby={`${id}-${slot.id}-title`} onClick={() => void handleExport(slot)}><T id="auto.ui.saveloadmodal.export" /></button>
                <button className="cc-save-load-danger" aria-describedby={`${id}-${slot.id}-title`} onClick={() => void handleDelete(slot)}>{t(confirmDeleteId === slot.id ? "save.deleteConfirm" : "save.delete")}</button>
              </div>
              {confirmDeleteId === slot.id && <div className="cc-save-load-delete-confirm">
                <p role="status">{t("save.deletePrompt", { name: slot.name })}</p>
                <button aria-describedby={`${id}-${slot.id}-title`} onClick={() => setConfirmDeleteId(null)}>{t("save.deleteCancel")}</button>
              </div>}
            </section>
          ))}
        </div>

        <footer className="cc-save-load-footer">
          <button onClick={() => fileInputRef.current?.click()}><T id="auto.ui.saveloadmodal.import.coursecraft.file" /></button>
          <input ref={fileInputRef} type="file" accept=".coursecraft,.json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImportFile(file);
            event.target.value = "";
          }} />
          <button className="cc-save-load-primary" onClick={props.onClose}><IconUi name="close" /><T id="auto.ui.saveloadmodal.close" /></button>
        </footer>
      </div>
    </div>
  );
}
