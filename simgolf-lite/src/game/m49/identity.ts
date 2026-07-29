import type { Course, World } from "../models/types";
import type { TournamentTier } from "../tournaments/types";
import { buildM49DemandPlan } from "./demand";
import { normalizeM49State } from "./history";
import type { M49AmenitySupport, M49MarketingPromise, M49StrategicIdentity } from "./types";

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
  return {
    segment,
    score: round(clamp(supportedBy.length / Math.max(1, Math.min(4, needs.length)))),
    supportedBy,
    missing: needs.filter((need) => !available.has(need as never)).slice(0, 4),
  };
}

/** Derive honest identity tags from the M48 portfolio and current facilities. */
export function strategicIdentity(course: Course, world: World): M49StrategicIdentity {
  const plan = buildM49DemandPlan(course, world, { samplesPerOption: 1 });
  const amenities = Object.fromEntries(Object.keys(AMENITY_NEEDS).map((segment) => [segment, amenitySupport(course, segment as keyof M49StrategicIdentity["amenities"]) ])) as M49StrategicIdentity["amenities"];
  const charter = world.seasonal?.charter ?? "public-gem";
  const charterTarget = CHARTER_TARGET[charter] ?? "casual";
  const charterFit = plan.segments[charterTarget].bookingAppeal;
  const segmentAppeal = (segment: keyof M49StrategicIdentity["amenities"]) => plan.segments[segment].bookingAppeal * .72 + amenities[segment].score * 100 * .28;
  const tournamentFieldFit = {
    local: round((segmentAppeal("casual") + segmentAppeal("senior")) / 200),
    regional: round((segmentAppeal("lowHandicap") + segmentAppeal("pro") + segmentAppeal("casual")) / 300),
    championship: round((segmentAppeal("pro") + segmentAppeal("lowHandicap")) / 200),
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
  const claimSupported = identity.strengths.some((strength) => strength.endsWith(`:${args.strength}`)) || args.strength === args.segment;
  const reach = clamp(.18 + args.world.marketingLevel / 5 * .5 + row.bookingAppeal * .34);
  const cost = Math.round(180 + reach * 520 + (claimSupported ? 0 : 160));
  if (args.world.cash < cost) return { ok: false, world: args.world, reason: `Marketing needs $${cost.toLocaleString("en-US")}.` };
  const credibility = clamp(row.strategicFit * .58 + row.observedValue * .42 - (claimSupported ? 0 : .24));
  const promise: M49MarketingPromise = {
    id: `m49-campaign-${args.world.runSeed}-${args.world.week}-${args.segment}-${args.strength}`,
    courseId: plan.courseId,
    segment: args.segment,
    strength: args.strength,
    reach: round(reach),
    cost,
    credibility: round(credibility),
    disappointmentRisk: round(clamp(1 - credibility + (claimSupported ? 0 : .18))),
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
