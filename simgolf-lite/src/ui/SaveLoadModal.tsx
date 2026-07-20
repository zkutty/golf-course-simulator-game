import { useCallback, useEffect, useRef, useState } from "react";
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
  type SaveSlotMeta,
} from "../utils/saveStore";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";
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

const kindLabel: Record<SaveSlotMeta["kind"], string> = {
  manual: "Manual",
  auto: "Auto",
  quick: "Quick",
};

export function SaveLoadModal(props: SaveLoadModalProps) {
  const { t } = useI18n();
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

  if (!props.open) return null;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  const handleSaveNew = async () => {
    if (!props.getPayload) return;
    const name = newName.trim() || `Save — week ${props.getPayload().world.week}`;
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

  const buttonStyle: React.CSSProperties = {
    padding: "5px 10px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "#fff",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={props.canSave ? "Save and load game" : "Load game"}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 99990,
      }}
      onClick={props.onClose}
    >
      <div ref={trapRef}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "85vh",
          overflowY: "auto",
          borderRadius: 18,
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(0,0,0,0.12)",
          boxShadow: "0 22px 55px rgba(0,0,0,0.22)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "#3d4a3e", marginBottom: 6 }}>
          {props.canSave ? "Save / Load" : "Load Game"}
        </div>
        {notice && (
          <div style={{ fontSize: 13, color: "#2f6b33", marginBottom: 10 }}>{notice}</div>
        )}

        {props.canSave && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={translateCurrent("auto.ui.saveloadmodal.new.save.name")}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.2)",
                fontSize: 13,
              }}
            />
            <button style={{ ...buttonStyle, background: "#3d4a3e", color: "#fff", fontWeight: 600 }} onClick={() => void handleSaveNew()}>
              <T id="auto.ui.saveloadmodal.save.to.new.slot" /></button>
          </div>
        )}

        {slots.length === 0 && (
          <div style={{ fontSize: 13, color: "#6b7280", margin: "18px 0" }}>
            <T id="auto.ui.saveloadmodal.no.saves.yet" />{props.canSave ? " — save your course above." : "."}
          </div>
        )}

        {slots.map((slot) => (
          <div
            key={slot.id}
            data-testid={`save-slot-${slot.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.1)",
              background: "#fff",
              marginBottom: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {slot.name}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontWeight: 600,
                    color: slot.kind === "manual" ? "#3d4a3e" : "#6b7280",
                    border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 6,
                    padding: "1px 6px",
                    verticalAlign: "middle",
                  }}
                >
                  {kindLabel[slot.kind]}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {slot.courseName} • {formatWeekLabel(slot.week, "en", "week")} • {formatCurrency(slot.cash)} • {slot.holesOpen}<T id="auto.ui.saveloadmodal.9.holes" />{slot.difficulty ? ` • ${slot.difficulty}` : ""}
                {slot.theme ? ` • ${slot.theme}` : ""} •{" "}
                {formatDateTime(slot.savedAt)}
              </div>
            </div>
            <button style={buttonStyle} onClick={() => void handleLoad(slot)}>
              <T id="auto.ui.saveloadmodal.load" /></button>
            {props.canSave && (
              <button style={buttonStyle} onClick={() => void handleOverwrite(slot)}>
                <T id="auto.ui.saveloadmodal.overwrite" /></button>
            )}
            <button style={buttonStyle} onClick={() => void handleRename(slot)}>
              <T id="auto.ui.saveloadmodal.rename" /></button>
            <button style={buttonStyle} onClick={() => void handleExport(slot)}>
              <T id="auto.ui.saveloadmodal.export" /></button>
            <button
              style={{
                ...buttonStyle,
                borderColor: confirmDeleteId === slot.id ? "#b91c1c" : "rgba(0,0,0,0.18)",
                color: confirmDeleteId === slot.id ? "#b91c1c" : undefined,
                fontWeight: confirmDeleteId === slot.id ? 700 : undefined,
              }}
              onClick={() => void handleDelete(slot)}
            >
              {confirmDeleteId === slot.id ? "Really?" : "Delete"}
            </button>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
            <T id="auto.ui.saveloadmodal.import.coursecraft.file" /></button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".coursecraft,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = "";
            }}
          />
          <button style={{ ...buttonStyle, background: "#3d4a3e", color: "#fff", fontWeight: 600 }} onClick={props.onClose}>
            <T id="auto.ui.saveloadmodal.close" /></button>
        </div>
      </div>
    </div>
  );
}
