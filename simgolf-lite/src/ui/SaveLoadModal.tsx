import { useCallback, useEffect, useRef, useState } from "react";
import type { SavePayload } from "../utils/save";
import {
  deleteSlot,
  exportSlot,
  importSave,
  listSlots,
  loadSlot,
  renameSlot,
  saveToSlot,
  type SaveSlotMeta,
} from "../utils/saveStore";

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
}

const kindLabel: Record<SaveSlotMeta["kind"], string> = {
  manual: "Manual",
  auto: "Auto",
  quick: "Quick",
};

export function SaveLoadModal(props: SaveLoadModalProps) {
  const [slots, setSlots] = useState<SaveSlotMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setNewName("");
    flash("Saved.");
    refresh();
  };

  const handleOverwrite = async (slot: SaveSlotMeta) => {
    if (!props.getPayload) return;
    await saveToSlot(slot.id, slot.kind, slot.name, props.getPayload());
    flash(`Overwrote "${slot.name}".`);
    refresh();
  };

  const handleLoad = async (slot: SaveSlotMeta) => {
    const payload = await loadSlot(slot.id);
    if (!payload) {
      flash("That slot could not be loaded.");
      refresh();
      return;
    }
    props.onLoaded(payload);
    props.onClose();
  };

  const handleDelete = async (slot: SaveSlotMeta) => {
    if (confirmDeleteId !== slot.id) {
      setConfirmDeleteId(slot.id);
      return;
    }
    await deleteSlot(slot.id);
    setConfirmDeleteId(null);
    flash(`Deleted "${slot.name}".`);
    refresh();
  };

  const handleRename = async (slot: SaveSlotMeta) => {
    const name = window.prompt("Rename save", slot.name);
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
    const meta = await importSave(text, file.name.replace(/\.coursecraft$|\.json$/i, ""));
    if (!meta) {
      flash("That file is not a valid CourseCraft save.");
      return;
    }
    flash(`Imported "${meta.name}".`);
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
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 999,
      }}
      onClick={props.onClose}
    >
      <div
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
              placeholder="New save name…"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.2)",
                fontSize: 13,
              }}
            />
            <button style={{ ...buttonStyle, background: "#3d4a3e", color: "#fff", fontWeight: 600 }} onClick={() => void handleSaveNew()}>
              Save to new slot
            </button>
          </div>
        )}

        {slots.length === 0 && (
          <div style={{ fontSize: 13, color: "#6b7280", margin: "18px 0" }}>
            No saves yet{props.canSave ? " — save your course above." : "."}
          </div>
        )}

        {slots.map((slot) => (
          <div
            key={slot.id}
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
                {slot.courseName} • week {slot.week} • ${slot.cash.toLocaleString()} • {slot.holesOpen}/9 holes •{" "}
                {new Date(slot.savedAt).toLocaleString()}
              </div>
            </div>
            <button style={buttonStyle} onClick={() => void handleLoad(slot)}>
              Load
            </button>
            {props.canSave && (
              <button style={buttonStyle} onClick={() => void handleOverwrite(slot)}>
                Overwrite
              </button>
            )}
            <button style={buttonStyle} onClick={() => void handleRename(slot)}>
              Rename
            </button>
            <button style={buttonStyle} onClick={() => void handleExport(slot)}>
              Export
            </button>
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
            Import .coursecraft file…
          </button>
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
