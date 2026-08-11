import { describe, expect, it } from "vitest";
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
