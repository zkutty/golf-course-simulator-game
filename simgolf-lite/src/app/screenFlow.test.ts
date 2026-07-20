import { describe, expect, it } from "vitest";
import { INITIAL_SCREEN_FLOW, reduceScreenFlow, type ScreenFlowEvent } from "./screenFlow";

describe("screen-flow state machine", () => {
  it("covers the title → setup → loading → game → pause path", () => {
    const events: ScreenFlowEvent[] = [
      { type: "OPEN_SETUP" },
      { type: "BEGIN_LOADING", label: "Growing your course…" },
      { type: "ENTER_GAME" },
      { type: "OPEN_PAUSE" },
      { type: "CLOSE_PAUSE" },
      { type: "BACK_TO_TITLE" },
    ];
    const states = events.reduce(
      (all, event) => [...all, reduceScreenFlow(all.at(-1)!, event)],
      [INITIAL_SCREEN_FLOW]
    );
    expect(states.map((state) => [state.base, state.paused])).toEqual([
      ["title", false],
      ["setup-wizard", false],
      ["loading", false],
      ["in-game", false],
      ["in-game", true],
      ["in-game", false],
      ["title", false],
    ]);
  });

  it.each(["options", "save-load", "golfopedia", "scenario-select"] as const)(
    "closes the %s modal before the pause layer",
    (modal) => {
      const game = { ...INITIAL_SCREEN_FLOW, base: "in-game" as const, paused: true };
      const opened = reduceScreenFlow(game, { type: "OPEN_MODAL", modal });
      expect(reduceScreenFlow(opened, { type: "CLOSE_TOP_LAYER" })).toEqual({ ...game, modal: null });
    }
  );

  it("rejects illegal transitions without flashing another base screen", () => {
    expect(reduceScreenFlow(INITIAL_SCREEN_FLOW, { type: "ENTER_GAME" })).toBe(INITIAL_SCREEN_FLOW);
    expect(reduceScreenFlow(INITIAL_SCREEN_FLOW, { type: "OPEN_PAUSE" })).toBe(INITIAL_SCREEN_FLOW);
    const loading = reduceScreenFlow(INITIAL_SCREEN_FLOW, { type: "BEGIN_LOADING", label: "Loading…" });
    expect(reduceScreenFlow(loading, { type: "OPEN_MODAL", modal: "options" })).toBe(loading);
  });
});
