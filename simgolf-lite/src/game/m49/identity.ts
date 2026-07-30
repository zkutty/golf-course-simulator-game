import type { Course, World } from "../models/types";
import type { TournamentTier } from "../tournaments/types";
import { buildM49DemandPlan } from "./demand";
import { normalizeM49State } from "./history";
import type { M49AmenitySupport, M49MarketingPromise, M49StrategicIdentity } from "./types";
import { m49CurrentMobilitySupport, m49MobilityHistoryDisappointment } from "./mobility";
import { m49CourseHistory } from "./history";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

const AMENITY_NEEDS: Record<keyof M49StrategicIdentity["amenities"], string[]> = {
  pro: ["practice_bays", "short_game_area", "event_space", "pro_shop"],
  lowHandicap: ["practice_bays", "putting_green", "short_game_area", "pro_shop"],
  casual: ["parking", "clubhouse", "restaurant", "snack_bar"],
  senior: ["parking", "clubhouse", "restaurant", "locker_room", "shuttle"],
  junior: ["practice_bays", "short_game_area", "putting_green", "clubhouse"],
  tourist: ["hotel", "lodge", "cottages", "restaurant", "spa", "shuttle"],
};

const CHARTER_TARGET: Record<string, keyof M49StrategicIdentity["amenities"]> = {
  "public-gem": "casual",
  "championship-venue": "pro",
  "destination-retreat": "tourist",
  "member-institution": "lowHandicap",
};

function amenitySupport(course: Course, segment: keyof M49StrategicIdentity["amenities"]): M49AmenitySupport {
  const available = new Set((course.property?.assets ?? []).filter((asset) => asset.enabled && asset.condition > .35).map((asset) => asset.kind));
  const needs = AMENITY_NEEDS[segment];
  const supportedBy = needs.filter((need) => available.has(need as never));
  const current = m49CurrentMobilitySupport(course, segment);
  return {
    segment,
    // Geometry/offers are a small current amenity signal; an unused fleet
    // cannot raise this score beyond the fact that a compatible option exists.
    score: round(clamp(supportedBy.length / Math.max(1, Math.min(4, needs.length)) * .78 + current.score * .22)),
    supportedBy: [...supportedBy, ...current.supportedBy.map((item) => `mobility:${item}`)],
    missing: [...needs.filter((need) => !available.has(need as never)), ...current.missing.map((item) => `mobility:${item}`)].slice(0, 6),
    mobility: {
      evidenceLabel: "predicted",
      score: current.score,
      observedRounds: 0,
      disappointmentRisk: 0,
      supportedBy: current.supportedBy,
      missing: current.missing,
    },
  };
}

/** Derive honest identity tags from the M48 portfolio and current facilities. */
export function strategicIdentity(course: Course, world: World): M49StrategicIdentity {
  const plan = buildM49DemandPlan(course, world, { samplesPerOption: 1 });
  const amenities = Object.fromEntries(Object.keys(AMENITY_NEEDS).map((segment) => [segment, amenitySupport(course, segment as keyof M49StrategicIdentity["amenities"]) ])) as M49StrategicIdentity["amenities"];
  const charter = world.seasonal?.charter ?? "public-gem";
  const charterTarget = CHARTER_TARGET[charter] ?? "casual";
  const history = m49CourseHistory(world, plan.courseId);
  for (const segment of Object.keys(amenities) as Array<keyof M49StrategicIdentity["amenities"]>) {
    const mobility = history?.segments[segment]?.mobility;
    if (!mobility || !amenities[segment].mobility) continue;
    amenities[segment].mobility = {
      ...amenities[segment].mobility,
      evidenceLabel: "mixed",
      observedRounds: mobility.observedRounds,
      disappointmentRisk: round(m49MobilityHistoryDisappointment(mobility)),
    };
  }
  const charterFit = plan.segments[charterTarget].bookingAppeal;
  const segmentAppeal = (segment: keyof M49StrategicIdentity["amenities"]) => plan.segments[segment].bookingAppeal * .72 + amenities[segment].score * 100 * .28;
  // M51's explicit tournament policy is walking-only.  Rental capacity and
  // ordinary-day riding results never make a tournament field look fitter.
  const tournamentWalking = (segment: keyof M49StrategicIdentity["amenities"]) => {
    const current = m49CurrentMobilitySupport(course, segment);
    const observed = history?.segments[segment]?.mobility;
    const walkingObserved = observed?.observedRounds && observed.walkingRounds
      ? clamp(observed.walkingRounds / observed.observedRounds * .7 + observed.averageValue * .3)
      : current.score;
    return clamp(walkingObserved * (1 - current.walkingBurden * .35));
  };
  const tournamentFieldFit = {
    local: round((segmentAppeal("casual") + segmentAppeal("senior")) / 200 * .86 + (tournamentWalking("casual") + tournamentWalking("senior")) / 2 * .14),
    regional: round((segmentAppeal("lowHandicap") + segmentAppeal("pro") + segmentAppeal("casual")) / 300 * .86 + (tournamentWalking("lowHandicap") + tournamentWalking("pro") + tournamentWalking("casual")) / 3 * .14),
    championship: round((segmentAppeal("pro") + segmentAppeal("lowHandicap")) / 200 * .86 + (tournamentWalking("pro") + tournamentWalking("lowHandicap")) / 2 * .14),
  };
  const strengths = (Object.keys(plan.segments) as Array<keyof M49StrategicIdentity["amenities"]>)
    .sort((a, b) => plan.segments[b].bookingAppeal - plan.segments[a].bookingAppeal || a.localeCompare(b))
    .slice(0, 3)
    .map((segment) => `${segment}:${Math.round(plan.segments[segment].bookingAppeal * 100)}`);
  const tags = [
    ...(plan.broadAppeal >= .62 ? ["broad-welcome"] : []),
    ...(plan.nicheIdentity >= .18 ? ["coherent-niche"] : []),
    ...plan.supportedSegments.slice(0, 4).map((segment) => `supports-${segment}`),
    ...(tournamentFieldFit.championship >= .62 ? ["championship-ready"] : []),
    ...(charterFit >= .58 ? [`charter-${charter}`] : ["charter-mismatch"]),
  ];
  const mobilityHistories = Object.values(history?.segments ?? {}).flatMap((segment) => segment?.mobility ? [segment.mobility] : []);
  const mobilityObservedRounds = mobilityHistories.reduce((sum, value) => sum + value.observedRounds, 0);
  const mobilityRisk = mobilityHistories.length
    ? mobilityHistories.reduce((sum, value) => sum + m49MobilityHistoryDisappointment(value), 0) / mobilityHistories.length
    : 0;
  return {
    courseId: plan.courseId,
    strategicScore: round(plan.totalIndex * 100),
    broadAppeal: plan.broadAppeal,
    nicheIdentity: plan.nicheIdentity,
    supportedSegments: plan.supportedSegments,
    strengths,
    tags: [...new Set(tags)],
    amenities,
    tournamentFieldFit,
    mobility: {
      evidenceLabel: mobilityObservedRounds ? "mixed" : "predicted",
      observedRounds: mobilityObservedRounds,
      disappointmentRisk: round(mobilityRisk),
      tournamentPolicy: "walking_only",
      note: mobilityObservedRounds ? "Mobility value reflects completed rounds; tournament fit remains walking-only by policy." : "Mobility availability reflects current geometry and offers only; completed-round evidence is still needed.",
    },
    charterFit: round(charterFit),
  };
}

export function tournamentIdentityFit(identity: M49StrategicIdentity, tier: TournamentTier): number {
  return identity.tournamentFieldFit[tier];
}

export function launchM49Marketing(args: {
  course: Course;
  world: World;
  segment: keyof M49StrategicIdentity["amenities"];
  strength: string;
}): { ok: true; world: World; promise: M49MarketingPromise } | { ok: false; world: World; reason: string } {
  const plan = buildM49DemandPlan(args.course, args.world);
  const identity = strategicIdentity(args.course, args.world);
  const row = plan.segments[args.segment];
  const mobilityClaim = /mobility|walking|pushcart|riding|cart|pace/i.test(args.strength);
  const claimSupported = !mobilityClaim && (identity.strengths.some((strength) => strength.endsWith(`:${args.strength}`)) || args.strength === args.segment)
    || mobilityClaim && row.mobility.evidenceLabel !== "predicted" && row.mobility.observedValue != null && row.mobility.observedValue >= .6 && row.mobility.disappointmentRisk < .4;
  const reach = clamp(.18 + args.world.marketingLevel / 5 * .5 + row.bookingAppeal * .34);
  const cost = Math.round(180 + reach * 520 + (claimSupported ? 0 : 160));
  if (args.world.cash < cost) return { ok: false, world: args.world, reason: `Marketing needs $${cost.toLocaleString("en-US")}.` };
  const credibility = clamp(row.strategicFit * .52 + row.observedValue * .38 + (mobilityClaim ? (row.mobility.observedValue ?? 0) * .1 : .1) - (claimSupported ? 0 : .24) - (mobilityClaim ? row.mobility.disappointmentRisk * .16 : 0));
  const promise: M49MarketingPromise = {
    id: `m49-campaign-${args.world.runSeed}-${args.world.week}-${args.segment}-${args.strength}`,
    courseId: plan.courseId,
    segment: args.segment,
    strength: args.strength,
    reach: round(reach),
    cost,
    credibility: round(credibility),
    disappointmentRisk: round(clamp(1 - credibility + (claimSupported ? 0 : .18) + (mobilityClaim ? row.mobility.disappointmentRisk * .18 : 0))),
    createdWeek: args.world.week,
    playedRounds: 0,
    disappointedRounds: 0,
  };
  const m49 = normalizeM49State(args.world.m49);
  return {
    ok: true,
    world: {
      ...args.world,
      cash: args.world.cash - cost,
      m49: {
        ...m49,
        marketingPromises: [...(m49.marketingPromises ?? []), promise].slice(-24),
      },
    },
    promise,
  };
}
