import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSaveStoreForTests,
  autosave,
  deleteSlot,
  exportSlot,
  importSave,
  listSlots,
  loadSlot,
  mostRecentSlot,
  quicksave,
  renameSlot,
  saveToSlot,
} from "./saveStore";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { SavePayload } from "./save";

function payload(week = 1, cash = 25_000, name = "Test Links"): SavePayload {
  return {
    course: { ...DEFAULT_COURSE, name },
    world: { ...DEFAULT_WORLD, week, cash },
    history: [],
  };
}

describe("saveStore", () => {
  beforeEach(() => {
    __resetSaveStoreForTests();
  });

  it("saves, lists, and loads a manual slot round-trip", async () => {
    const meta = await saveToSlot(null, "manual", "My course", payload(7, 31_500));
    expect(meta.week).toBe(7);
    expect(meta.cash).toBe(31_500);
    expect(meta.courseName).toBe("Test Links");

    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("My course");

    const loaded = await loadSlot(meta.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.world.week).toBe(7);
    expect(loaded!.course.elevations).toHaveLength(DEFAULT_COURSE.width * DEFAULT_COURSE.height);
  });

  it("overwrites when saving to an existing slot id", async () => {
    const meta = await saveToSlot(null, "manual", "Slot", payload(1));
    await saveToSlot(meta.id, "manual", "Slot", payload(9));
    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].week).toBe(9);
  });

  it("autosave rotates through three slots, replacing the oldest", async () => {
    for (let week = 1; week <= 5; week++) {
      await autosave(payload(week));
    }
    const autos = (await listSlots()).filter((m) => m.kind === "auto");
    expect(autos).toHaveLength(3);
    const weeks = autos.map((m) => m.week).sort((a, b) => a - b);
    expect(weeks).toEqual([3, 4, 5]); // weeks 1-2 rotated out
  });

  it("quicksave reuses one slot; rename and delete work", async () => {
    await quicksave(payload(2));
    await quicksave(payload(3));
    let slots = await listSlots();
    expect(slots.filter((m) => m.kind === "quick")).toHaveLength(1);
    expect(slots[0].week).toBe(3);

    await renameSlot("quick", "Before the lake job");
    slots = await listSlots();
    expect(slots[0].name).toBe("Before the lake job");

    await deleteSlot("quick");
    expect(await listSlots()).toHaveLength(0);
    expect(await loadSlot("quick")).toBeNull();
  });

  it("mostRecentSlot returns the newest of any kind", async () => {
    const a = await saveToSlot(null, "manual", "Old", payload(1));
    a.savedAt = 0; // not persisted; recency is by savedAt at write time
    await autosave(payload(2));
    const recent = await mostRecentSlot();
    expect(recent!.kind).toBe("auto");
  });

  it("export → import round-trips a playable payload as a new slot", async () => {
    const meta = await saveToSlot(null, "manual", "Exported", payload(12, 40_000));
    const text = await exportSlot(meta.id);
    expect(text).not.toBeNull();
    expect(JSON.parse(text!).appProfile).toMatchObject({ version: 4, gameplay: { autosaveCadence: "weekly" }, achievements: { earned: [] } });

    __resetSaveStoreForTests(); // fresh browser
    const imported = await importSave(text!, "Imported course");
    expect(imported).not.toBeNull();
    const loaded = await loadSlot(imported!.id);
    expect(loaded!.world.week).toBe(12);
    expect(loaded!.world.cash).toBe(40_000);
  });

  it("sanitizes malformed buildings on import instead of crashing later", async () => {
    const p = payload(2);
    const file = JSON.stringify({
      schemaVersion: 1,
      savedAt: 0,
      course: {
        ...p.course,
        buildings: [
          { type: "castle", x: 1, y: 1 }, // unknown type
          { type: "clubhouse", x: -5, y: 2 }, // out of bounds
          { type: "clubhouse", x: 3.7, y: 4 }, // non-integer
          "junk", // not even an object
          { type: "clubhouse", x: 3, y: 4 }, // the one valid entry
        ],
      },
      world: p.world,
    });
    const meta = await importSave(file, "sneaky");
    expect(meta).not.toBeNull();
    const loaded = await loadSlot(meta!.id);
    expect(loaded!.course.buildings).toEqual([{ type: "clubhouse", x: 3, y: 4 }]);

    const nonArray = JSON.stringify({
      schemaVersion: 1,
      savedAt: 0,
      course: { ...p.course, buildings: "nope" },
      world: p.world,
    });
    const meta2 = await importSave(nonArray, "sneaky2");
    expect((await loadSlot(meta2!.id))!.course.buildings).toEqual([]);
  });

  it("hostile imports return null and leave existing slots untouched", async () => {
    await saveToSlot(null, "manual", "Keep me", payload(4));
    expect(await importSave("not json at all", "x")).toBeNull();
    expect(await importSave('{"schemaVersion":99}', "x")).toBeNull();
    expect(await importSave('{"schemaVersion":1,"course":{"tiles":"nope"},"world":{}}', "x")).toBeNull();
    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("Keep me");
  });
});
