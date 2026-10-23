import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveStatus } from "../hooks/useLiveSimulation";
import { LiveControls } from "./LiveControls";

const status = {
  speed: "paused",
  dayIndex: 0,
  dayMinute: 0,
  clockLabel: "6:00 AM",
  onCourse: 0,
  roundsToday: 0,
  greenFeesToday: 0,
  concessionsToday: 0,
  arrivalsRemaining: 0,
  nextArrivalMinute: null,
  lastDay: null,
  selected: null,
  golfers: [],
  tournament: null,
  pace: null,
} as unknown as LiveStatus;

function render(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(<LiveControls
    status={status}
    speed="paused"
    onSetSpeed={vi.fn()}
    cash={0}
    reputation={0}
    week={1}
    {...overrides}
  />);
}

describe("LiveControls pacing actions", () => {
  it("keeps pacing actions hidden unless their callbacks are supplied", () => {
    const markup = render();
    expect(markup).not.toContain("live-next-event");
    expect(markup).not.toContain("live-finish-day");
    expect(markup).toContain('data-testid="speed-paused"');
    expect(markup).toContain('data-testid="speed-1x"');
    expect(markup).toContain('data-testid="speed-2x"');
    expect(markup).toContain('data-testid="speed-4x"');
  });

  it("explains disabled actions and exposes cancellable advance status accessibly", () => {
    const disabled = render({
      onNextEvent: vi.fn(),
      onFinishDay: vi.fn(),
      advanceDisabledReason: "controlled-round",
    });
    expect(disabled).toMatch(/<button[^>]*disabled=""[^>]*data-testid="live-next-event"/);
    expect(disabled).toContain('title="Finish or leave the controlled round before advancing."');
    expect(disabled).toMatch(/<button[^>]*disabled=""[^>]*data-testid="live-finish-day"/);

    const advancing = render({
      onNextEvent: vi.fn(),
      onFinishDay: vi.fn(),
      onCancelAdvance: vi.fn(),
      advancing: "next-event",
    });
    expect(advancing).toContain('role="status" aria-live="polite" data-testid="live-advance-status"');
    expect(advancing).toContain("Advancing to next event");
    expect(advancing).toContain('data-testid="live-stop-advance"');
    expect(advancing).toMatch(/<button[^>]*disabled=""[^>]*data-testid="speed-1x"/);
    expect(advancing).toMatch(/<button[^>]*disabled=""[^>]*data-testid="live-finish-day"/);
  });
});
