import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  resolveTournamentStandings,
  type TournamentEvidenceStatus,
  type TournamentStandingEvidence,
} from "./tournamentStandings";

function row(
  competitorId: string,
  rankingTotal: number | null,
  options: { rounds?: number; status?: TournamentEvidenceStatus; prize?: boolean; tieBreakKey?: string } = {},
): TournamentStandingEvidence {
  const status = options.status ?? "completed";
  const eligible = status === "active" || status === "completed";
  const rounds = options.rounds ?? (eligible ? 1 : 0);
  return {
    competitorId,
    status,
    completedRounds: rounds,
    holesCompleted: eligible ? rounds * 18 : 0,
    scoreTotal: eligible ? 72 * rounds + (rankingTotal ?? 0) : null,
    rankingTotal: eligible ? rankingTotal : null,
    scoreToPar: eligible ? rankingTotal : null,
    rankEligible: eligible,
    prizeEligible: options.prize ?? status === "completed",
    tieBreakKey: options.tieBreakKey ?? competitorId,
  };
}

describe("ZK-737 cumulative standings and occupied-share purse authority", () => {
  it("preserves competition places across ties and splits every occupied share", () => {
    const resolved = resolveTournamentStandings([
      row("beta", -8),
      row("alpha", -8),
      row("charlie", -6),
      row("echo", -4),
      row("delta", -4),
    ], { total: 101, occupiedPlaceShares: [50, 25, 15, 10] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.standings.map(({ competitorId, place, tied, occupiedPlaces }) => ({ competitorId, place, tied, occupiedPlaces }))).toEqual([
      { competitorId: "alpha", place: 1, tied: true, occupiedPlaces: [1, 2] },
      { competitorId: "beta", place: 1, tied: true, occupiedPlaces: [1, 2] },
      { competitorId: "charlie", place: 3, tied: false, occupiedPlaces: [3] },
      { competitorId: "delta", place: 4, tied: true, occupiedPlaces: [4, 5] },
      { competitorId: "echo", place: 4, tied: true, occupiedPlaces: [4, 5] },
    ]);
    expect(resolved.winnerIds).toEqual(["alpha", "beta"]);
    expect(resolved.pursePlan).toEqual({
      version: 1,
      configuredTotal: 101,
      occupiedPlaceAmounts: [51, 25, 15, 10],
      awards: [
        { competitorId: "alpha", place: 1, occupiedPlaces: [1, 2], amount: 38 },
        { competitorId: "beta", place: 1, occupiedPlaces: [1, 2], amount: 38 },
        { competitorId: "charlie", place: 3, occupiedPlaces: [3], amount: 15 },
        { competitorId: "delta", place: 4, occupiedPlaces: [4, 5], amount: 5 },
        { competitorId: "echo", place: 4, occupiedPlaces: [4, 5], amount: 5 },
      ],
      distributedTotal: 101,
    });
  });

  it.each([1, 2, 3, 4] as const)("ranks cumulative evidence after %i contiguous rounds", (rounds) => {
    const resolved = resolveTournamentStandings([
      row("one", -3 * rounds, { rounds, status: rounds === 4 ? "completed" : "active", prize: rounds === 4 }),
      row("two", -1 * rounds, { rounds, status: rounds === 4 ? "completed" : "active", prize: rounds === 4 }),
      row("three", 2 * rounds, { rounds, status: rounds === 4 ? "completed" : "active", prize: rounds === 4 }),
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.standings.map((standing) => [standing.competitorId, standing.completedRounds, standing.place])).toEqual([
      ["one", rounds, 1], ["two", rounds, 2], ["three", rounds, 3],
    ]);
    expect(resolved.winnerIds).toEqual(rounds === 4 ? ["one"] : []);
  });

  it("allows negative team score totals without weakening finite ranking evidence", () => {
    const negative = { ...row("team-negative", -12), scoreTotal: -12 };
    const resolved = resolveTournamentStandings([negative, row("team-even", 0)]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.standings[0]).toMatchObject({ competitorId: "team-negative", scoreTotal: -12, place: 1 });
  });

  it("keeps withdrawals, DNF, incomplete, and invalid evidence unplaced and unpaid", () => {
    const resolved = resolveTournamentStandings([
      row("winner", -2),
      row("withdrawn", null, { status: "withdrawn" }),
      row("dnf", null, { status: "dnf" }),
      row("incomplete", null, { status: "incomplete" }),
      row("invalid", null, { status: "invalid" }),
    ], { total: 9, occupiedPlaceShares: [1] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.standings.slice(1).every((standing) => standing.place === null && standing.scoreTotal === null && standing.rankingTotal === null)).toBe(true);
    expect(resolved.pursePlan?.awards).toEqual([{ competitorId: "winner", place: 1, occupiedPlaces: [1], amount: 9 }]);
  });

  it("fails closed for duplicate, non-finite, unknown-key, and incomplete purse carriers", () => {
    const valid = row("valid", 0);
    expect(resolveTournamentStandings([valid, { ...valid }])).toMatchObject({ ok: false, reason: expect.stringContaining("unique") });
    expect(resolveTournamentStandings([{ ...valid, rankingTotal: Number.NaN }])).toMatchObject({ ok: false });
    expect(resolveTournamentStandings([{ ...valid, hostile: true } as never])).toMatchObject({ ok: false, reason: expect.stringContaining("exact") });
    expect(resolveTournamentStandings([row("active", 0, { status: "active", prize: false })], { total: 10, occupiedPlaceShares: [1] })).toMatchObject({ ok: false, reason: expect.stringContaining("purse") });
    expect(() => resolveTournamentStandings([null] as never)).not.toThrow();
  });

  it("allows zero-share unpaid tails while preserving the configured purse", () => {
    const resolved = resolveTournamentStandings([row("winner", -2)], { total: 101, occupiedPlaceShares: [1, 0, 0, 0] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.pursePlan).toMatchObject({ configuredTotal: 101, occupiedPlaceAmounts: [101, 0, 0, 0], distributedTotal: 101 });
    expect(resolved.pursePlan?.awards).toEqual([{ competitorId: "winner", place: 1, occupiedPlaces: [1], amount: 101 }]);
  });

  it("reports completed tied winners independently of purse eligibility and rejects a partially eligible paid tie", () => {
    const tied = [row("eligible", -4), row("ineligible", -4, { prize: false })];
    const standings = resolveTournamentStandings(tied);
    expect(standings.ok && standings.winnerIds).toEqual(["eligible", "ineligible"]);
    expect(resolveTournamentStandings(tied, { total: 10, occupiedPlaceShares: [1, 0] })).toMatchObject({ ok: false, reason: expect.stringContaining("purse") });
  });

  it("preserves exact purse totals and ranking bytes across generated ties and JSON reload", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.array(fc.integer({ min: -20, max: 40 }), { minLength: 1, maxLength: 16 }),
      fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 16 }).filter((shares) => shares.some(Boolean)),
      (purse, scores, generatedShares) => {
        const shares = Array.from({ length: scores.length }, (_, index) => generatedShares[index % generatedShares.length]);
        if (!shares.some(Boolean)) shares[0] = 1;
        const evidence = scores.map((score, index) => row(`competitor-${String(index).padStart(2, "0")}`, score));
        const first = resolveTournamentStandings(evidence, { total: purse, occupiedPlaceShares: shares });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.pursePlan?.distributedTotal).toBe(purse);
        expect(first.pursePlan?.awards.reduce((sum, award) => sum + award.amount, 0)).toBe(purse);
        const reloaded = resolveTournamentStandings(JSON.parse(JSON.stringify(evidence)), JSON.parse(JSON.stringify({ total: purse, occupiedPlaceShares: shares })));
        expect(JSON.stringify(reloaded)).toBe(JSON.stringify(first));
      },
    ), { numRuns: 200 });
  });
});
