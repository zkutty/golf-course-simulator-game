import { describe, expect, it, vi } from "vitest";
import type { PlayerShotPreview } from "../../game/playerPro/playerPro";
import { createPlayerShotPreviewReceiver } from "./shotPreviewReceiver";

function preview(x = 10): PlayerShotPreview {
  return {
    available: true, blocker: null, carryYards: 100, targetYards: 100,
    dispersionTiles: 1, expectedPenalty: 0, landingTerrain: "fairway",
    risk: "low", recommended: true, flightProfile: "standard",
    sharedOutcome: null, greenRollout: null, automaticPuttingEstimate: null,
    shotSlope: null,
    expectedFlight: { from: { x: 0, y: 0 }, landing: { x, y: 0 },
      apexHeightYards: 20, curveOffsetTiles: 0, envelope: [] },
  };
}

describe("Player Pro preview receiver", () => {
  it("suppresses equal, cloned and irrelevant changes before invoking the setter", () => {
    const publish = vi.fn();
    const receive = createPlayerShotPreviewReceiver(publish);
    const first = preview();
    receive(first);
    for (let i = 0; i < 80; i++) {
      receive(structuredClone(first));
      receive({ ...first, carryYards: i, available: false });
    }
    expect(publish.mock.calls).toEqual([[first]]);
  });

  it("preserves rapid A to B to A before a simulated pending render flushes", () => {
    const queued: PlayerShotPreview[] = [];
    const receive = createPlayerShotPreviewReceiver((value) => queued.push(value));
    const a = preview(10);
    const b = preview(20);
    receive(a);
    receive(structuredClone(a));
    receive(b);
    receive(structuredClone(b));
    receive(a);
    expect(queued).toEqual([a, b, a]);
    expect(queued.at(-1)).toBe(a);
  });

  it("retains the old null and undefined projection behavior", () => {
    const publish = vi.fn();
    const receive = createPlayerShotPreviewReceiver(publish);
    const absent = { ...preview(), expectedFlight: undefined };
    // Runtime preview consumers historically normalize null and absence alike.
    const nullFlight = { ...absent, expectedFlight: null } as unknown as PlayerShotPreview;
    receive(absent);
    receive(nullFlight);
    expect(publish).not.toHaveBeenCalled();
    const present = preview();
    receive(present);
    receive(nullFlight);
    receive(absent);
    receive(present);
    expect(publish.mock.calls).toEqual([[present], [nullFlight], [present]]);
  });

  it("rejects the old in-setter guard as a control for redundant scheduling", () => {
    const queued: Array<(previous: PlayerShotPreview | null) => PlayerShotPreview | null> = [];
    const oldSetter = (update: typeof queued[number]) => queued.push(update);
    const oldReceive = (next: PlayerShotPreview) => oldSetter((previous) =>
      JSON.stringify(previous?.expectedFlight ?? null) === JSON.stringify(next.expectedFlight ?? null) ? previous : next);
    const publish = vi.fn();
    const receive = createPlayerShotPreviewReceiver(publish);
    for (let i = 0; i < 80; i++) {
      oldReceive(preview());
      receive(preview());
    }
    expect(queued).toHaveLength(80);
    expect(publish).toHaveBeenCalledTimes(1);
    const final = queued.reduce<PlayerShotPreview | null>((state, update) => update(state), null);
    expect(final).toEqual(publish.mock.calls[0][0]);
  });

  it("starts each independent receiver lifetime with the initial null projection", () => {
    const publish = vi.fn();
    const firstLifetime = createPlayerShotPreviewReceiver(publish);
    firstLifetime(preview());
    firstLifetime(preview());
    const nextLifetime = createPlayerShotPreviewReceiver(publish);
    nextLifetime({ ...preview(), expectedFlight: undefined });
    nextLifetime(preview());
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
