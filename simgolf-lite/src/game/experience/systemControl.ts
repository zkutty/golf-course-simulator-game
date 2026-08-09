import type { EconomicPressure, ExperienceProfile, World } from "../models/types";
import type { AutomationSystem } from "../seasons/types";

/** Stable save/API identifiers. Never derive this contract from the legacy M39 list. */
export const ADVANCED_SYSTEM_IDS = [
  "maintenance",
  "localized-turf",
  "irrigation",
  "drainage",
  "staffing",
  "pace",
  "financing",
  "memberships",
  "tournaments",
  "property",
  "resort",
  "mobility",
  "community",
] as const;

export type AdvancedSystemId = (typeof ADVANCED_SYSTEM_IDS)[number];
export type SystemControlMode = "automated" | "manual";
export type SystemControlVisibility = "hidden" | "summary" | "full";
export type SystemControlSource = "profile-default" | "save-override";
export type SystemAutomationAdapter = "seasonal-operations" | "authoritative-noop";

export type RelaxedRecoverySource = "live-day" | "weekly";
export type RelaxedRecoveryReason = "cash-deficit" | "poor-turf" | "severe-weather" | "expansion-stress";

export interface RelaxedRecoveryReceiptV1 {
  id: string;
  source: RelaxedRecoverySource;
  week: number;
  day?: number;
  economicPressure: EconomicPressure;
  cashBefore: number;
  cashAfterSettlement: number;
  relief: number;
  repayment: number;
  cashAfter: number;
  outstandingAdvance: number;
  reasons: RelaxedRecoveryReason[];
  automatedDomains: AdvancedSystemId[];
}

export interface RelaxedRecoveryStateV1 {
  version: 1;
  /** Recoverable reserve advances are liabilities, never profit or prizes. */
  outstandingAdvance: number;
  totalRelief: number;
  totalRepaid: number;
  receipts: RelaxedRecoveryReceiptV1[];
  /** Monotonic exact-once guards survive receipt compaction. */
  lastSettled: {
    liveAbsoluteDay: number;
    weeklyWeek: number;
  };
}

export interface SystemControlStateV1 {
  version: 1;
  /** Sparse by design: effective profile defaults are never copied into a save. */
  overrides: Partial<Record<AdvancedSystemId, SystemControlMode>>;
  /** Monotonic evidence that prevents a save from being graduated backwards. */
  highestProfile: ExperienceProfile;
  graduations: Array<{
    from: ExperienceProfile;
    to: ExperienceProfile;
    week: number;
  }>;
  /** Sparse audit/liability carrier; omitted until guided recovery is used. */
  recovery?: RelaxedRecoveryStateV1;
}

export interface EffectiveSystemPolicy {
  id: AdvancedSystemId;
  visibility: SystemControlVisibility;
  mode: SystemControlMode;
  source: SystemControlSource;
  overridden: boolean;
  directControl: boolean;
  automationAdapter: SystemAutomationAdapter;
}

interface RegistryEntry {
  automationAdapter: SystemAutomationAdapter;
}

/**
 * One registry owns discovery, default visibility, and default control mode.
 * `authoritative-noop` means the system continues its normal deterministic
 * simulation, but no safe automatic command currently exists for it.
 */
const COMMAND_ADAPTER_IDS = new Set<AdvancedSystemId>(["maintenance", "localized-turf", "irrigation", "property", "resort"]);
const RELAXED_HIDDEN_IDS = new Set<AdvancedSystemId>(["localized-turf", "irrigation", "drainage", "resort", "mobility"]);
export const SYSTEM_CONTROL_REGISTRY = Object.fromEntries(ADVANCED_SYSTEM_IDS.map((id) => [id, {
  automationAdapter: COMMAND_ADAPTER_IDS.has(id) ? "seasonal-operations" : "authoritative-noop",
}])) as Record<AdvancedSystemId, RegistryEntry>;

const PROFILE_ORDER: readonly ExperienceProfile[] = ["relaxed", "classic", "simulation"];
const ID_SET = new Set<string>(ADVANCED_SYSTEM_IDS);
const RECOVERY_SOURCES = new Set<RelaxedRecoverySource>(["live-day", "weekly"]);
const RECOVERY_REASONS = new Set<RelaxedRecoveryReason>(["cash-deficit", "poor-turf", "severe-weather", "expansion-stress"]);
const PRESSURES = new Set<EconomicPressure>(["friendly", "balanced", "tight"]);
const MAX_RECOVERY_RECEIPTS = 32;

function isProfile(value: unknown): value is ExperienceProfile {
  return value === "relaxed" || value === "classic" || value === "simulation";
}

function profileRank(profile: ExperienceProfile): number {
  return PROFILE_ORDER.indexOf(profile);
}

function maxProfile(left: ExperienceProfile, right: ExperienceProfile): ExperienceProfile {
  return profileRank(left) >= profileRank(right) ? left : right;
}

function validMode(value: unknown): value is SystemControlMode {
  return value === "automated" || value === "manual";
}

function baseState(profile: ExperienceProfile): SystemControlStateV1 {
  return { version: 1, overrides: {}, highestProfile: profile, graduations: [] };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function finiteCash(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function normalizeRecoveryReceipt(input: unknown): RelaxedRecoveryReceiptV1 | null {
  if (!isPlainRecord(input) || typeof input.id !== "string" || input.id.length < 1 || input.id.length > 160) return null;
  if (!RECOVERY_SOURCES.has(input.source as RelaxedRecoverySource)) return null;
  if (!Number.isInteger(input.week) || (input.week as number) < 0) return null;
  if (input.day != null && (!Number.isInteger(input.day) || (input.day as number) < 0 || (input.day as number) > 6)) return null;
  if (!PRESSURES.has(input.economicPressure as EconomicPressure)) return null;
  if (!finiteCash(input.cashBefore) || !finiteCash(input.cashAfterSettlement) || !finiteCash(input.cashAfter)) return null;
  if (!finiteNonNegative(input.relief) || !finiteNonNegative(input.repayment) || !finiteNonNegative(input.outstandingAdvance)) return null;
  if ((input.relief as number) > 0 && (input.repayment as number) > 0) return null;
  if ((input.relief as number) === 0 && (input.repayment as number) === 0) return null;
  if (input.source === "weekly" && input.day != null) return null;
  if (input.source === "live-day" && input.day == null) return null;
  if (cents(input.cashAfter as number) !== cents((input.cashAfterSettlement as number) + (input.relief as number) - (input.repayment as number))) return null;
  if ((input.relief as number) > 0 && cents(input.cashAfter as number) !== 0) return null;
  if ((input.repayment as number) > 0 && (input.repayment as number) > (input.cashAfterSettlement as number)) return null;
  const reasons = Array.isArray(input.reasons)
    ? [...new Set(input.reasons.filter((reason): reason is RelaxedRecoveryReason => RECOVERY_REASONS.has(reason as RelaxedRecoveryReason)))].slice(0, RECOVERY_REASONS.size)
    : [];
  const automatedDomains = Array.isArray(input.automatedDomains)
    ? [...new Set(input.automatedDomains.filter((id): id is AdvancedSystemId => ID_SET.has(String(id))))].slice(0, ADVANCED_SYSTEM_IDS.length)
    : [];
  return {
    id: input.id,
    source: input.source as RelaxedRecoverySource,
    week: input.week as number,
    ...(input.day == null ? {} : { day: input.day as number }),
    economicPressure: input.economicPressure as EconomicPressure,
    cashBefore: input.cashBefore,
    cashAfterSettlement: input.cashAfterSettlement,
    relief: input.relief,
    repayment: input.repayment,
    cashAfter: input.cashAfter,
    outstandingAdvance: input.outstandingAdvance,
    reasons,
    automatedDomains,
  };
}

export function normalizeRelaxedRecoveryState(input: unknown): RelaxedRecoveryStateV1 | undefined {
  if (!isPlainRecord(input) || input.version !== 1) return undefined;
  if (!Array.isArray(input.receipts)) return undefined;
  if (!isPlainRecord(input.lastSettled)
    || !Number.isInteger(input.lastSettled.liveAbsoluteDay)
    || !Number.isInteger(input.lastSettled.weeklyWeek)
    || (input.lastSettled.liveAbsoluteDay as number) < -1
    || (input.lastSettled.weeklyWeek as number) < -1) return undefined;
  if ((input.lastSettled.weeklyWeek as number) >= 0
    && (input.lastSettled.liveAbsoluteDay as number) < (input.lastSettled.weeklyWeek as number) * 7 + 6) return undefined;
  if (!finiteNonNegative(input.outstandingAdvance) || !finiteNonNegative(input.totalRelief) || !finiteNonNegative(input.totalRepaid)) return undefined;
  if ((input.totalRepaid as number) > (input.totalRelief as number)
    || cents(input.outstandingAdvance as number) !== cents((input.totalRelief as number) - (input.totalRepaid as number))) return undefined;
  const receipts: RelaxedRecoveryReceiptV1[] = [];
  for (const raw of input.receipts.slice(-MAX_RECOVERY_RECEIPTS)) {
    const receipt = normalizeRecoveryReceipt(raw);
    if (!receipt || receipts.some((known) => known.id === receipt.id)) continue;
    receipts.push(receipt);
  }
  if (receipts.length > 0 && cents(receipts[receipts.length - 1].outstandingAdvance) !== cents(input.outstandingAdvance as number)) return undefined;
  if (receipts.some((receipt) => receipt.source === "weekly"
    ? receipt.week > (input.lastSettled as Record<string, number>).weeklyWeek
    : receipt.week * 7 + receipt.day! > (input.lastSettled as Record<string, number>).liveAbsoluteDay)) return undefined;
  return {
    version: 1,
    outstandingAdvance: input.outstandingAdvance,
    totalRelief: input.totalRelief,
    totalRepaid: input.totalRepaid,
    receipts,
    lastSettled: {
      liveAbsoluteDay: input.lastSettled.liveAbsoluteDay as number,
      weeklyWeek: input.lastSettled.weeklyWeek as number,
    },
  };
}

export function isValidRelaxedRecoveryStateV1(input: unknown): input is RelaxedRecoveryStateV1 {
  if (!isPlainRecord(input) || input.version !== 1 || !Array.isArray(input.receipts) || input.receipts.length > MAX_RECOVERY_RECEIPTS) return false;
  if (!finiteNonNegative(input.outstandingAdvance) || !finiteNonNegative(input.totalRelief) || !finiteNonNegative(input.totalRepaid)) return false;
  const receipts = input.receipts.map(normalizeRecoveryReceipt);
  return receipts.every((receipt) => receipt != null)
    && new Set(receipts.map((receipt) => receipt!.id)).size === receipts.length
    && normalizeRelaxedRecoveryState(input) != null;
}

/** Strict migration gate: legacy fallback wins unless the entire v1 carrier is valid. */
export function isValidSystemControlStateV1(input: unknown): input is SystemControlStateV1 {
  if (!isPlainRecord(input) || input.version !== 1) return false;
  const highestProfile = input.highestProfile;
  if (!isProfile(highestProfile)) return false;
  if (!isPlainRecord(input.overrides) || !Array.isArray(input.graduations) || input.graduations.length > 2) return false;
  if (input.recovery != null && !isValidRelaxedRecoveryStateV1(input.recovery)) return false;
  if (Object.entries(input.overrides).some(([id, mode]) => !ID_SET.has(id) || !validMode(mode))) return false;
  return input.graduations.every((entry) => {
    if (!isPlainRecord(entry) || !isProfile(entry.from) || !isProfile(entry.to)) return false;
    return profileRank(entry.to) === profileRank(entry.from) + 1
      && profileRank(entry.to) <= profileRank(highestProfile)
      && Number.isInteger(entry.week)
      && (entry.week as number) >= 0;
  });
}

export function createSystemControlState(profile: ExperienceProfile): SystemControlStateV1 {
  return baseState(profile);
}

/** Hostile-data-safe, deterministic and idempotent carrier normalization. */
export function normalizeSystemControlState(input: unknown, currentProfile: ExperienceProfile): SystemControlStateV1 {
  if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1) {
    return baseState(currentProfile);
  }
  const candidate = input as Partial<SystemControlStateV1>;
  const overrides: SystemControlStateV1["overrides"] = {};
  if (candidate.overrides && typeof candidate.overrides === "object" && !Array.isArray(candidate.overrides)) {
    for (const id of ADVANCED_SYSTEM_IDS) {
      const mode = candidate.overrides[id];
      if (validMode(mode)) overrides[id] = mode;
    }
  }
  const savedHighest = isProfile(candidate.highestProfile) ? candidate.highestProfile : currentProfile;
  const highestProfile = maxProfile(currentProfile, savedHighest);
  const graduations = Array.isArray(candidate.graduations)
    ? candidate.graduations.filter((entry): entry is SystemControlStateV1["graduations"][number] => {
        if (!entry || typeof entry !== "object") return false;
        const value = entry as SystemControlStateV1["graduations"][number];
        return isProfile(value.from)
          && isProfile(value.to)
          && profileRank(value.to) === profileRank(value.from) + 1
          && profileRank(value.to) <= profileRank(highestProfile)
          && Number.isInteger(value.week)
          && value.week >= 0;
      }).slice(0, 2)
    : [];
  const recovery = normalizeRelaxedRecoveryState(candidate.recovery);
  return { version: 1, overrides, highestProfile, graduations, ...(recovery ? { recovery } : {}) };
}

export function effectiveSystemPolicy(
  profile: ExperienceProfile,
  state: SystemControlStateV1,
  id: AdvancedSystemId,
): EffectiveSystemPolicy {
  const definition = SYSTEM_CONTROL_REGISTRY[id];
  const override = state.overrides[id];
  const defaultMode = profile === "simulation" ? "manual" : "automated";
  const visibility = profile === "simulation" ? "full" : profile === "relaxed" && RELAXED_HIDDEN_IDS.has(id) ? "hidden" : "summary";
  const mode = override ?? defaultMode;
  return {
    id,
    visibility,
    mode,
    source: override ? "save-override" : "profile-default",
    overridden: override != null,
    directControl: mode === "manual",
    automationAdapter: definition.automationAdapter,
  };
}

export function resolveSystemControlPolicy(world: Pick<World, "experienceProfile" | "systemControl">) {
  const requestedProfile = isProfile(world.experienceProfile) ? world.experienceProfile : "classic";
  const state = normalizeSystemControlState(world.systemControl, requestedProfile);
  const profile = maxProfile(requestedProfile, state.highestProfile);
  return {
    version: 1 as const,
    profile,
    canGraduateTo: PROFILE_ORDER[profileRank(profile) + 1] ?? null,
    systems: ADVANCED_SYSTEM_IDS.map((id) => effectiveSystemPolicy(profile, state, id)),
  };
}

const LEGACY_SYSTEM_TO_DOMAIN: Record<AutomationSystem, AdvancedSystemId> = {
  hours: "property",
  upkeep: "maintenance",
  pricing: "property",
  staffing: "staffing",
  parking: "mobility",
  lodging: "resort",
  community: "community",
  safety: "community",
};

const LEGACY_SYSTEMS = Object.keys(LEGACY_SYSTEM_TO_DOMAIN) as AutomationSystem[];

export function advancedSystemForLegacyAutomation(system: AutomationSystem): AdvancedSystemId {
  return LEGACY_SYSTEM_TO_DOMAIN[system];
}

/**
 * Schema-v30 bridge. The global advanced flag historically disabled every
 * automatic decision; otherwise only the explicitly mapped legacy strings
 * are imported. The eight strings are not used as the new registry.
 */
export function migrateLegacySystemControl(world: World): World {
  const profile = isProfile(world.experienceProfile) ? world.experienceProfile : "classic";
  if (isValidSystemControlStateV1(world.systemControl)) {
    return { ...world, systemControl: normalizeSystemControlState(world.systemControl, profile) };
  }
  const state = baseState(profile);
  const seasonal = world.seasonal && typeof world.seasonal === "object" ? world.seasonal : undefined;
  const legacy = seasonal?.automation && typeof seasonal.automation === "object" ? seasonal.automation : undefined;
  if (!legacy || legacy.advancedOperations === true) {
    for (const id of ADVANCED_SYSTEM_IDS) state.overrides[id] = "manual";
  } else {
    for (const legacyId of Array.isArray(legacy.overrides) ? legacy.overrides : []) {
      if (legacyId in LEGACY_SYSTEM_TO_DOMAIN) state.overrides[LEGACY_SYSTEM_TO_DOMAIN[legacyId]] = "manual";
    }
  }
  return { ...world, systemControl: state };
}

/** Synchronize the compatibility M39 carrier from the effective 13-domain policy. */
export function reconcileSystemControlWorld(world: World): World {
  const requestedProfile = isProfile(world.experienceProfile) ? world.experienceProfile : "classic";
  const state = normalizeSystemControlState(world.systemControl, requestedProfile);
  const profile = maxProfile(requestedProfile, state.highestProfile);
  const normalizedState = state.highestProfile === profile ? state : { ...state, highestProfile: profile };
  let seasonal = world.seasonal;
  if (seasonal?.automation) {
    const manualLegacy = LEGACY_SYSTEMS.filter((legacyId) =>
      effectiveSystemPolicy(profile, normalizedState, LEGACY_SYSTEM_TO_DOMAIN[legacyId]).mode === "manual");
    const advancedOperations = manualLegacy.length === LEGACY_SYSTEMS.length;
    const unchanged = advancedOperations === seasonal.automation.advancedOperations
      && manualLegacy.length === seasonal.automation.overrides.length
      && manualLegacy.every((id, index) => seasonal!.automation.overrides[index] === id);
    if (!unchanged) {
      seasonal = {
        ...seasonal,
        automation: {
          ...seasonal.automation,
          advancedOperations,
          overrides: manualLegacy,
        },
      };
    }
  }
  if (
    world.experienceProfile === profile
    && world.systemControl === normalizedState
    && world.seasonal === seasonal
  ) return world;
  return { ...world, experienceProfile: profile, systemControl: normalizedState, seasonal };
}

export type SystemControlCommand =
  | { type: "TAKE_SYSTEM_CONTROL"; system: AdvancedSystemId }
  | { type: "RETURN_SYSTEM_TO_PROFILE"; system: AdvancedSystemId }
  | { type: "GRADUATE_EXPERIENCE_PROFILE"; target: ExperienceProfile };

export interface SystemControlCommandResult {
  ok: boolean;
  world: World;
  message: string;
}

function isSystemId(value: unknown): value is AdvancedSystemId {
  return typeof value === "string" && ID_SET.has(value);
}

/** Atomic command authority for takeover, return, and one-way graduation. */
export function applySystemControlCommand(world: World, command: SystemControlCommand): SystemControlCommandResult {
  const reconciled = reconcileSystemControlWorld(world);
  const profile = reconciled.experienceProfile ?? "classic";
  const state = normalizeSystemControlState(reconciled.systemControl, profile);
  if (command.type === "TAKE_SYSTEM_CONTROL" || command.type === "RETURN_SYSTEM_TO_PROFILE") {
    if (!isSystemId(command.system)) return { ok: false, world, message: "system-control|invalid-system" };
    const overrides = { ...state.overrides };
    if (command.type === "TAKE_SYSTEM_CONTROL") overrides[command.system] = "manual";
    else delete overrides[command.system];
    const next = reconcileSystemControlWorld({ ...reconciled, systemControl: { ...state, overrides } });
    return {
      ok: true,
      world: next,
      message: command.type === "TAKE_SYSTEM_CONTROL"
        ? `system-control|take|${command.system}`
        : `system-control|return|${command.system}|${next.experienceProfile}|${effectiveSystemPolicy(next.experienceProfile ?? profile, next.systemControl!, command.system).mode}`,
    };
  }
  const currentRank = profileRank(profile);
  if (!isProfile(command.target) || profileRank(command.target) !== currentRank + 1) {
    return { ok: false, world, message: "system-control|invalid-graduation" };
  }
  const graduations = [
    ...state.graduations.filter((entry) => entry.to !== command.target),
    { from: profile, to: command.target, week: Math.max(0, Math.floor(reconciled.week)) },
  ].slice(0, 2);
  const next = reconcileSystemControlWorld({
    ...reconciled,
    experienceProfile: command.target,
    systemControl: { ...state, highestProfile: command.target, graduations },
  });
  return { ok: true, world: next, message: `system-control|graduate|${command.target}` };
}

/** Compact UI/advisor/text envelope; intentionally omits histories and defaults tables. */
export function systemControlEnvelope(world: Pick<World, "experienceProfile" | "systemControl">) {
  const policy = resolveSystemControlPolicy(world);
  const state = normalizeSystemControlState(world.systemControl, policy.profile);
  const recovery = state.recovery;
  return {
    version: policy.version,
    profile: policy.profile,
    canGraduateTo: policy.canGraduateTo,
    systems: policy.systems.map(({ id, visibility, mode, source, overridden, automationAdapter }) => ({
      id,
      visibility,
      mode,
      source,
      override: overridden,
      automation: automationAdapter,
    })),
    recovery: recovery && (recovery.receipts.length > 0 || recovery.outstandingAdvance > 0) ? {
      version: recovery.version,
      outstandingAdvance: recovery.outstandingAdvance,
      totalRelief: recovery.totalRelief,
      totalRepaid: recovery.totalRepaid,
      actions: recovery.receipts.length,
      latest: recovery.receipts[recovery.receipts.length - 1] ?? null,
    } : null,
  };
}
