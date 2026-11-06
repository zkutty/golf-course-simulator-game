import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppProfile } from "../game/onboarding/profile";
import { useAdvisorSeen } from "./useAdvisorSeen";

const PROFILE_KEY = "coursecraft_app_profile_v5";
function countedStorage(seed: Record<string, string>, failure?: "get" | "set") {
  const values = new Map(Object.entries(seed));
  const reads: string[] = [], writes: Array<[string, string]> = [];
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    getItem: (key) => {
      reads.push(key);
      if (failure === "get") throw new Error("storage read unavailable");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      writes.push([key, value]);
      if (failure === "set") throw new Error("storage write unavailable");
      values.set(key, value);
    },
  };
  return { storage, values, reads, writes };
}

type SeenRef = ReturnType<typeof useAdvisorSeen>;
function Probe({ observe }: { observe: (seen: SeenRef, render: number) => void }) {
  const seen = useAdvisorSeen();
  const [render, setRender] = useState(0);
  observe(seen, render);
  if (render < 2) setRender(render + 1);
  return createElement("span", null, [...seen.current].join(","));
}

afterEach(() => vi.unstubAllGlobals());

describe("advisor-seen initialization", () => {
  it("uses the real legacy migration and first normalized write only once across rerenders", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const seed = {
      coursecraft_app_profile_v1: JSON.stringify({ version: 1, advisorSeen: ["first", "first", 7, null, "second"], gameplay: { defaultGameSpeed: "3x" } }),
      coursecraft_audio_volumes: JSON.stringify({ musicVolume: 0.7 }),
      coursecraft_ambience: "off",
    };
    const reference = countedStorage(seed), store = countedStorage(seed);
    const expected = loadAppProfile(reference.storage);
    vi.stubGlobal("localStorage", store.storage);
    const refs: SeenRef[] = [];
    renderToStaticMarkup(createElement(Probe, { observe: (seen: SeenRef) => { refs.push(seen); } }));
    expect(refs).toHaveLength(3);
    expect(refs.every((ref) => ref === refs[0] && ref.current === refs[0].current)).toBe(true);
    expect([...refs[0].current]).toEqual(expected.advisorSeen);
    expect([...refs[0].current]).toEqual(["first", "second"]);
    expect(store.reads).toEqual(reference.reads);
    expect(store.writes).toEqual(reference.writes);
    expect(store.writes).toHaveLength(1);
    expect(store.values.get(PROFILE_KEY)).toBe(reference.values.get(PROFILE_KEY));
    expect(JSON.parse(store.values.get(PROFILE_KEY)!)).toMatchObject({
      version: 5, advisorSeen: ["first", "second"], gameplay: { defaultGameSpeed: "4x" },
      audio: { musicVolume: 0.7 }, graphics: { ambienceFx: false }, accessibility: { reducedMotion: true },
    });
  });

  it("keeps mutable seen IDs and ignores changed storage until a genuine remount", () => {
    const store = countedStorage({ [PROFILE_KEY]: JSON.stringify({ version: 5, advisorSeen: ["initial"] }) });
    vi.stubGlobal("localStorage", store.storage);
    const refs: SeenRef[] = [];
    let afterExternalRead: string[] = [], afterExternalWrite: Array<[string, string]> = [];
    renderToStaticMarkup(createElement(Probe, { observe: (seen: SeenRef, render: number) => {
      refs.push(seen);
      if (render === 0) {
        seen.current.add("dismissed");
        const profile = JSON.parse(store.values.get(PROFILE_KEY)!);
        store.storage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, advisorSeen: ["external"] }));
        afterExternalRead = [...store.reads];
        afterExternalWrite = [...store.writes];
      } else {
        expect(store.reads).toEqual(afterExternalRead);
        expect(store.writes).toEqual(afterExternalWrite);
      }
    } }));
    expect(refs).toHaveLength(3);
    expect(refs.every((ref) => ref === refs[0] && ref.current === refs[0].current)).toBe(true);
    expect([...refs[0].current]).toEqual(["initial", "dismissed"]);
    const reference = countedStorage({ [PROFILE_KEY]: store.values.get(PROFILE_KEY)! });
    const expected = loadAppProfile(reference.storage);
    const readsBefore = store.reads.length, writesBefore = store.writes.length;
    const remounted: SeenRef[] = [];
    renderToStaticMarkup(createElement(Probe, { observe: (seen: SeenRef) => { remounted.push(seen); } }));
    expect(remounted).toHaveLength(3);
    expect(remounted.every((ref) => ref === remounted[0] && ref.current === remounted[0].current)).toBe(true);
    expect(remounted[0]).not.toBe(refs[0]);
    expect(remounted[0].current).not.toBe(refs[0].current);
    expect([...remounted[0].current]).toEqual(expected.advisorSeen);
    expect([...remounted[0].current]).toEqual(["external"]);
    expect(store.reads.slice(readsBefore)).toEqual(reference.reads);
    expect(store.writes.slice(writesBefore)).toEqual(reference.writes);
  });

  it.each(["get", "set"] as const)("preserves real loader defaults when storage %s fails without retrying ignored renders", (failure) => {
    const seed = { [PROFILE_KEY]: JSON.stringify({ version: 5, advisorSeen: ["not-returned-on-error"] }) };
    const reference = countedStorage(seed, failure), store = countedStorage(seed, failure);
    const expected = loadAppProfile(reference.storage);
    vi.stubGlobal("localStorage", store.storage);
    const refs: SeenRef[] = [];
    renderToStaticMarkup(createElement(Probe, { observe: (seen: SeenRef, render: number) => {
      refs.push(seen);
      if (render === 0) {
        expect([...seen.current]).toEqual(expected.advisorSeen);
        expect([...seen.current]).toEqual([]);
        seen.current.add("local");
      }
    } }));
    expect(refs).toHaveLength(3);
    expect(refs.every((ref) => ref === refs[0] && ref.current === refs[0].current)).toBe(true);
    expect([...refs[0].current]).toEqual(["local"]);
    expect(store.reads).toEqual(reference.reads);
    expect(store.writes).toEqual(reference.writes);
  });
});
