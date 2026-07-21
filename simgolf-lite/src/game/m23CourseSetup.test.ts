import { describe, expect, it } from "vitest";
import { applyAction } from "../core/reducer";
import { DEFAULT_STATE } from "./gameState";
import { createReferenceCourse } from "./testing/referenceCourse";
import { getPinPosition, getTeeBox, resolveCourseSetup, withNormalizedHoleSetup } from "./models/courseSetup";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./sim/courseRating";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../utils/save";
import { DEFAULT_WORLD } from "./models/defaults";
import { createLiveState, stepLive } from "./live/simulation";
import { LIVE } from "./live/liveConfig";
import { hashGameState } from "../utils/stateHash";

function configuredCourse() {
  const base = createReferenceCourse();
  const tiles = [...base.tiles];
  const hole = base.holes[0];
  const forward = { x: 20, y: hole.tee!.y };
  const championship = { x: 4, y: hole.tee!.y };
  const pinB = { x: hole.green!.x - 1, y: hole.green!.y };
  const pinC = { x: hole.green!.x + 1, y: hole.green!.y };
  tiles[forward.y * base.width + forward.x] = "tee";
  tiles[championship.y * base.width + championship.x] = "tee";
  const configured = withNormalizedHoleSetup({
    ...hole,
    teeBoxes: { forward, member: hole.tee, championship },
    pinPositions: { A: hole.green, B: pinB, C: pinC },
  });
  return { ...base, tiles, holes: [configured], activePinRotation: "B" as const };
}

describe("M23 course setup model", () => {
  it("migrates legacy v6 tee/green markers losslessly to Member/A", () => {
    const legacy = createReferenceCourse();
    const result = normalizeLoadedSaveResult({ schemaVersion: 6, savedAt: 1, course: legacy, world: DEFAULT_WORLD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe(7);
    expect(result.migratedFrom).toBe(6);
    expect(getTeeBox(result.payload.course.holes[0], "member")).toEqual(legacy.holes[0].tee);
    expect(getPinPosition(result.payload.course.holes[0], "A")).toEqual(legacy.holes[0].green);
    expect(getTeeBox(result.payload.course.holes[0], "forward")).toBeNull();
    expect(result.payload.course.activePinRotation).toBe("A");
    expect(hashGameState({ course: legacy, world: DEFAULT_WORLD })).toBe(hashGameState({ course: result.payload.course, world: result.payload.world }));
  });

  it("edits markers atomically and rejects duplicate, non-green, and misordered setup", () => {
    const course = createReferenceCourse();
    const initial = { ...DEFAULT_STATE, course, world: { ...DEFAULT_WORLD, cash: 50_000 } };
    const forward = { x: 20, y: course.holes[0].tee!.y };
    const withForward = applyAction(initial, { type: "SET_TEE_BOX", holeIndex: 0, teeSet: "forward", position: forward });
    expect(getTeeBox(withForward.course.holes[0], "forward")).toEqual(forward);
    expect(withForward.course.tiles[forward.y * course.width + forward.x]).toBe("tee");
    expect(withForward.world.cash).toBeLessThan(initial.world.cash);

    const duplicate = applyAction(withForward, { type: "SET_TEE_BOX", holeIndex: 0, teeSet: "championship", position: forward });
    expect(duplicate).toEqual(withForward);
    const misordered = applyAction(withForward, { type: "SET_TEE_BOX", holeIndex: 0, teeSet: "championship", position: { x: 40, y: forward.y } });
    expect(misordered).toEqual(withForward);
    const nonGreen = applyAction(withForward, { type: "SET_PIN_POSITION", holeIndex: 0, pinRotation: "B", position: forward });
    expect(nonGreen).toEqual(withForward);

    const pinB = { x: course.holes[0].green!.x - 1, y: course.holes[0].green!.y };
    const withPin = applyAction(withForward, { type: "SET_PIN_POSITION", holeIndex: 0, pinRotation: "B", position: pinB });
    expect(getPinPosition(withPin.course.holes[0], "B")).toEqual(pinB);
    const removed = applyAction(withPin, { type: "REMOVE_PIN_POSITION", holeIndex: 0, pinRotation: "B" });
    expect(getPinPosition(removed.course.holes[0], "B")).toBeNull();
    expect(removed.course.tiles[pinB.y * course.width + pinB.x]).toBe("green");
  });

  it("publishes deterministic per-tee ratings normalized to 18-hole equivalents", () => {
    const course = configuredCourse();
    const ratings = computeRatingsByTee(course);
    expect(ratings.forward.effectiveYardage).toBeLessThan(ratings.member.effectiveYardage);
    expect(ratings.member.effectiveYardage).toBeLessThan(ratings.championship.effectiveYardage);
    expect(ratings.member.rotationsUsed).toEqual(["A", "B", "C"]);
    expect(ratings.member.holesUsed).toBe(9);
    expect(computeRatingsByTee(course)).toBe(ratings);
    expect(computeCourseRatingAndSlope({ ...course, activePinRotation: "A" })).toEqual(computeCourseRatingAndSlope({ ...course, activePinRotation: "C" }));
    expect(computeRatingForSetup(course, "member", "B").pinDifficultyDelta).toBeGreaterThanOrEqual(0);
  });

  it("assigns archetype tees and active pins with Member/A fallbacks", () => {
    const course = configuredCourse();
    const casual = createLiveState(course, DEFAULT_WORLD, 0);
    casual.arrivals = [{ atMinute: LIVE.day.openMinute, archetype: "casual" }];
    stepLive(casual, course, 1);
    expect(casual.golfers[0].teeSet).toBe("forward");
    expect(casual.golfers[0].pinRotation).toBe("B");

    const pro = createLiveState(course, DEFAULT_WORLD, 0);
    pro.arrivals = [{ atMinute: LIVE.day.openMinute, archetype: "pro" }];
    stepLive(pro, course, 1);
    expect(pro.golfers[0].teeSet).toBe("championship");
    const legacyPro = createLiveState(createReferenceCourse(), DEFAULT_WORLD, 0);
    legacyPro.arrivals = [{ atMinute: LIVE.day.openMinute, archetype: "pro" }];
    stepLive(legacyPro, createReferenceCourse(), 1);
    expect(legacyPro.golfers[0].teeSet).toBe("member");
    expect(resolveCourseSetup(createReferenceCourse().holes[0], "championship", "C")).toMatchObject({ teeSet: "member", pinRotation: "A", usedTeeFallback: true, usedPinFallback: true });
  });
});
