import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nContext } from "../i18n/context";
import { translate, type Locale } from "../i18n/core";
import * as playerShots from "../game/playerPro/playerPro";
import type { PlayerPlayableRound, PlayerProCareer } from "../game/models/playerProTypes";
import type { PlayerShotPreview, PlayerShotSelection } from "../game/playerPro/playerPro";
import type { SharedShotOutcome } from "../game/rules/contracts";
import { dispersionClubIdForLabel } from "../game/rules/dispersionRegistry";
import { defaultShotStyle, calculateShotStyleEffects } from "../game/rules/shotStyles";
import { createShotModelSnapshotV1 } from "../game/rules/shotModelSnapshot";
import { PlayerShotHud } from "./PlayerProPanel";
import { DEFAULT_WORLD } from "../game/models/defaults";
import { createDefaultPlayerPro } from "../game/playerPro/playerPro";
import { playerProTournamentEntries, playerProTournamentEntryEligibility } from "../game/playerPro/playerProPanelAuthority";
import type { TournamentEvent } from "../game/tournaments/types";

const field = [{ id: "entrant", name: "Entrant", archetype: "pro" as const, skill: .8 }];
const scheduled: TournamentEvent = { id: "scheduled", name: "Scheduled", tier: "local", scheduledWeek: 2, scheduledDay: 3, status: "scheduled", bookingCost: 1, revenueAward: 1, reputationAward: 1, field };
const active: TournamentEvent = { ...scheduled, id: "active", name: "Active", status: "active", roundCount: 2, currentRound: 2, rounds: [
  { roundNumber: 1, scheduledWeek: 2, scheduledDay: 3, status: "completed", scorecards: [] },
  { roundNumber: 2, scheduledWeek: 2, scheduledDay: 4, status: "active", scorecards: [] },
] };

describe("Player Pro tournament production surface", () => {
  it("lists scheduled plus the player's entered active event and gates continuation to its current day", () => {
    const career = { ...createDefaultPlayerPro({ seed: 733 }), tournaments: [{ id: "record", eventId: active.id, name: active.name, tier: active.tier, status: "active" as const }] };
    const world = { ...DEFAULT_WORLD, week: 2, tournaments: { version: 2 as const, events: [scheduled, active, { ...active, id: "other" }] } };
    expect(playerProTournamentEntries(world, career).map((event) => event.id)).toEqual(["scheduled", "active"]);
    expect(playerProTournamentEntryEligibility(career, scheduled, world, 2)).toEqual({ eligible: false, reason: "round_date" });
    expect(playerProTournamentEntryEligibility(career, scheduled, world, 3)).toEqual({ eligible: true, reason: null });
    expect(playerProTournamentEntryEligibility(career, active, world, 3).eligible).toBe(false);
    expect(playerProTournamentEntryEligibility(career, active, world, 4).eligible).toBe(true);
    expect(playerProTournamentEntryEligibility(career, { ...active, rounds: active.rounds?.map((round) => round.roundNumber === 2 ? { ...round, status: "interrupted" } : round) }, world, 4).eligible).toBe(false);
  });
});


function hudRound(newModel = true): PlayerPlayableRound {
  const holes = [{ id: "one", name: "First", par: 4, tee: { x: 2, y: 5 }, pin: { x: 24, y: 5 }, waypoints: [] }];
  return { version: 1, id: "hud", kind: "casual", phase: "awaiting_shot",
    course: { courseId: "hud", courseName: "HUD fixture", theme: "parkland", width: 32, height: 12, yardsPerTile: 10,
      tiles: Array(384).fill("fairway"), elevations: Array(384).fill(0), obstacles: [], holes,
      ...(newModel ? { shotModel: createShotModelSnapshotV1() } : {}) },
    teeSet: "member", pinRotation: "A", currentHoleIndex: 0, ball: holes[0].tee, lie: "fairway",
    strokes: 0, penalties: 0, scorecard: [{ holeId: "one", name: "First", par: 4, strokes: 0, penalties: 0, complete: false }],
    shots: [], pendingShot: null, rngSeed: 45, rngCursor: 0, autoPlay: false, rewardsApplied: false, startedWeek: 1, startedDay: 0 };
}

function renderHud(options: { newModel?: boolean; club?: string; style?: PlayerShotSelection["style"]; locale?: Locale; locked?: boolean; phase?: PlayerPlayableRound["phase"]; skip?: boolean; blocked?: boolean } = {}) {
  const career: PlayerProCareer = createDefaultPlayerPro({ seed: 332 });
  career.skills = { power: 80, driving: 80, irons: options.locked ? 20 : 80, shortGame: 80, putting: 80, recovery: 80 };
  const round = hudRound(options.newModel ?? true);
  round.phase = options.phase ?? "awaiting_shot";
  const selection: PlayerShotSelection = { club: options.club ?? "7 Iron", aim: { x: 15, y: 5 }, power: 1, technique: "normal", ...(options.style ? { style: options.style } : {}) };
  const selectedClubId = dispersionClubIdForLabel(selection.club)!;
  const styled = calculateShotStyleEffects({ clubId: selectedClubId, lie: "fairway", style: options.style ?? defaultShotStyle(selectedClubId), power: 1, recoverySkill: 80, shortGameSkill: 80 });
  if (!styled.ok) throw new Error(styled.blocker.message);
  const preview: PlayerShotPreview = { available: !options.blocked, blocker: options.blocked ? "style_club_mismatch" : null,
    carryYards: 122, targetYards: 130, dispersionTiles: 1.5, expectedPenalty: .05, landingTerrain: "fairway", risk: "low", recommended: true,
    flightProfile: styled.value.effectiveSelection.flightProfile, shotEffects: styled.value.effects,
    impact: styled.value.impact,
    sharedOutcome: { flight: { profile: "standard", launchAngleDegrees: 25, apexHeightYards: 20, clearance: [] },
      collision: { kind: "terrain", point: { x: 987.6, y: 543.2 }, terrain: "SECRET_SEEDED_CONTACT" },
      ruling: { status: "in_play" }, relief: { type: "SECRET_SEEDED_RELIEF" }, finalPosition: { x: 987.6, y: 543.2 } } as unknown as SharedShotOutcome,
    greenRollout: null,
    automaticPuttingEstimate: { expectedPutts: 1.4, leaveDistanceYards: 6.8, breakTiles: .2, realizedSpeedFeet: 10 } as PlayerShotPreview["automaticPuttingEstimate"],
    shotSlope: null };
  vi.spyOn(playerShots, "caddieShotGuidance").mockReturnValue({ selection, preview, shotSlope: null });
  const previewSpy = vi.spyOn(playerShots, "previewPlayableShot").mockReturnValue(preview);
  const locale = options.locale ?? "en";
  const markup = renderToStaticMarkup(<I18nContext.Provider value={{ locale, setLocale: () => undefined, t: (key, params) => translate(locale, key, params) }}>
    <PlayerShotHud career={career} round={round} aim={selection.aim} onAim={() => undefined} onCommit={() => undefined}
      onAdvance={() => undefined} onAutoFinish={() => undefined} onConcede={() => undefined} onReturnToDesign={() => undefined}
      {...(options.skip ? { onSkipShot: () => undefined } : {})} />
  </I18nContext.Provider>);
  return { markup, previewSpy };
}

describe("Player shot styles and expected preview surface", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers localized styles and expected impact while withholding sampled contact, relief and automatic putts", () => {
    const { markup } = renderHud();
    expect(markup).toContain('data-testid="player-shot-style"');
    expect(markup).toContain("High Spin");
    expect(markup).toContain("Style availability and requirements");
    expect(markup).toContain("Stopping potential:");
    expect(markup).toContain("before surface and slope effects");
    expect(markup).toContain("actual contact and rest can vary");
    for (const secret of ["SECRET_SEEDED", "987.6", "543.2", 'data-testid="player-shot-rules-preview"', 'data-testid="player-shot-auto-putt-preview"', 'data-testid="player-shot-green-rollout-preview"', "RPM"]) expect(markup).not.toContain(secret);
    expect(markup).toContain('aria-describedby="player-shot-style-hint"');
    expect(markup).toContain("overflow-wrap:anywhere");
  });

  it("keeps the historical technique and seeded preview surface for legacy rounds", () => {
    const { markup, previewSpy } = renderHud({ newModel: false });
    expect(markup).not.toContain('data-testid="player-shot-style"');
    expect(markup).toContain("Technique");
    expect(markup).toContain("SECRET_SEEDED_CONTACT");
    expect(markup).toContain('data-testid="player-shot-auto-putt-preview"');
    expect(previewSpy.mock.calls[0][2]).not.toHaveProperty("style");
  });

  it("uses canonical High Spin technique and high flight together", () => {
    const { markup, previewSpy } = renderHud({ style: "high_spin" });
    expect(previewSpy.mock.calls[0][2]).toMatchObject({ style: "high_spin", technique: "backspin", flightProfile: "high" });
    expect(markup).toMatch(/data-testid="player-shot-flight-high" aria-pressed="true"/);
    expect(markup).toContain("High Spin is locked to high flight");
  });

  it.each([["Putter", "putt", "standard"], ["Chip", "chip", "low"]] as const)("defaults %s to its contextual style", (club, style, flightProfile) => {
    const { markup, previewSpy } = renderHud({ club });
    expect(previewSpy.mock.calls[0][2]).toMatchObject({ club, style, technique: "normal", flightProfile });
    expect(markup).toContain(`<option value="${style}" selected="">`);
  });

  it("explains Pitch as a partial wedge and preserves the requested power for shared authority", () => {
    const { markup, previewSpy } = renderHud({ style: "pitch", club: "Pitching Wedge" });
    expect(markup).toContain("Controlled partial wedge shot");
    expect(previewSpy.mock.calls[0][2]).toMatchObject({ club: "Pitching Wedge", style: "pitch", technique: "normal", flightProfile: "standard", power: 1 });
  });

  it("explains incompatible and skill-locked options in native keyboard controls", () => {
    const { markup } = renderHud({ locked: true });
    expect(markup).toMatch(/<option value="high_spin" disabled="">High Spin · Requires Irons 62/);
    expect(markup).toMatch(/<option value="pitch" disabled="">Pitch · Unavailable with 7 Iron from fairway/);
    expect(markup).toContain('id="player-shot-style-hint" role="status"');
  });

  it("renders expanded pseudo copy and a disabled blocked shot", () => {
    const { markup } = renderHud({ locale: "pseudo", blocked: true });
    expect(markup).toContain("⟦");
    expect(markup).not.toContain("playerPro.shot.style.");
    expect(markup).toMatch(/data-testid="commit-player-shot" disabled=""/);
    expect(markup).toContain('role="alert"');
  });

  it("exposes Skip animation only when an actual flight callback exists", () => {
    expect(renderHud({ phase: "flight", skip: true }).markup).toContain('data-testid="skip-player-shot"');
    vi.restoreAllMocks();
    expect(renderHud({ phase: "flight" }).markup).not.toContain('data-testid="skip-player-shot"');
  });
});
