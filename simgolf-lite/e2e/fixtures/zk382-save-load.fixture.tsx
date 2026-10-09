import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { SaveLoadModal } from "../../src/ui/SaveLoadModal";
import { parseSaveText, type SavePayload } from "../../src/utils/save";
import { __deleteSlotPayloadForTests, deleteSlot, exportSlot, listSlots, loadSlotResult, saveToSlot } from "../../src/utils/saveStore";
import "../../src/index.css";

const longName = "Willow_Creek_Championship_Course_Complete_Saved_Progress_With_A_Very_Long_Unbroken_Name";
const initialPayload: SavePayload = { course: { ...structuredClone(DEFAULT_COURSE), name: longName }, world: { ...structuredClone(DEFAULT_WORLD), week: 42, cash: 123456 }, history: [] };
export interface SaveLoadFixture {
  ready: boolean;
  payload: () => SavePayload;
  calls: () => { type: "close" | "saved" | "loaded"; payload?: SavePayload }[];
  slots: typeof listSlots;
  bytes: typeof exportSlot;
  load: typeof loadSlotResult;
  removePayload: typeof __deleteSlotPayloadForTests;
  clear: () => Promise<void>;
  addExternal: () => Promise<void>;
  setWeek: (week: number) => void;
  parse: typeof parseSaveText;
}
declare global { interface Window { __saveLoadFixture: SaveLoadFixture } }

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const [ready, setReady] = useState(false);
  const payload = useRef(structuredClone(initialPayload));
  const calls = useRef<ReturnType<SaveLoadFixture["calls"]>>([]);
  useEffect(() => {
    window.__saveLoadFixture = {
      ready: false, parse: parseSaveText, payload: () => structuredClone(payload.current), calls: () => structuredClone(calls.current),
      slots: listSlots, bytes: exportSlot, load: loadSlotResult, removePayload: __deleteSlotPayloadForTests,
      clear: async () => { for (const slot of await listSlots()) await deleteSlot(slot.id); },
      addExternal: async () => { await saveToSlot("fixture-external", "manual", "External subscription save", payload.current); },
      setWeek: (week) => { payload.current.world.week = week; },
    };
    void (async () => {
      for (const [id, kind, name] of [["fixture-manual", "manual", longName], ["auto-0", "auto", "Autosave championship progress"], ["quick", "quick", "Quicksave championship progress"]] as const) await saveToSlot(id, kind, name, payload.current);
      window.__saveLoadFixture.ready = true;
      setReady(true);
    })();
  }, []);
  return <I18nProvider>
    <button data-testid="open-save-load" disabled={!ready} onClick={() => { setCanSave(true); setOpen(true); }}>Open save and load</button>
    <button data-testid="open-load-only" disabled={!ready} onClick={() => { setCanSave(false); setOpen(true); }}>Open load only</button>
    <SaveLoadModal open={open} canSave={canSave} getPayload={() => payload.current} onClose={() => { calls.current.push({ type: "close" }); setOpen(false); }} onSaved={() => calls.current.push({ type: "saved" })} onLoaded={(loaded) => calls.current.push({ type: "loaded", payload: structuredClone(loaded) })} />
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
