import type {
  AdvancedSystemId,
  SystemControlMode,
  SystemControlSource,
} from "../game/experience/systemControl";
import type { ExperienceProfile } from "../game/models/types";
import type { FacilityUpkeepPolicy } from "../game/property/types";
import type { AutomationPreset } from "../game/seasons/types";
import type { MessageKey } from "../i18n/catalog";
import { translateCurrent } from "../i18n/core";

const SYSTEM_KEYS: Record<AdvancedSystemId, MessageKey> = {
  maintenance: "season.automation.system.maintenance",
  "localized-turf": "season.automation.system.localized-turf",
  irrigation: "season.automation.system.irrigation",
  drainage: "season.automation.system.drainage",
  staffing: "season.automation.system.staffing",
  pace: "season.automation.system.pace",
  financing: "season.automation.system.financing",
  memberships: "season.automation.system.memberships",
  tournaments: "season.automation.system.tournaments",
  property: "season.automation.system.property",
  resort: "season.automation.system.resort",
  mobility: "season.automation.system.mobility",
  community: "season.automation.system.community",
};

const PROFILE_KEYS: Record<ExperienceProfile, MessageKey> = {
  relaxed: "season.automation.profile.relaxed",
  classic: "season.automation.profile.classic",
  simulation: "season.automation.profile.simulation",
};

const MODE_KEYS: Record<SystemControlMode, MessageKey> = {
  automated: "season.automation.mode.automated",
  manual: "season.automation.mode.manual",
};

const SOURCE_KEYS: Record<SystemControlSource, MessageKey> = {
  "profile-default": "season.automation.source.profile-default",
  "save-override": "season.automation.source.save-override",
};

const PRESET_KEYS: Record<AutomationPreset, MessageKey> = {
  stewardship: "season.automation.presetValue.stewardship",
  balanced: "season.automation.presetValue.balanced",
  growth: "season.automation.presetValue.growth",
};

const UPKEEP_KEYS: Record<FacilityUpkeepPolicy, MessageKey> = {
  lean: "season.automation.upkeep.lean",
  standard: "season.automation.upkeep.standard",
  premium: "season.automation.upkeep.premium",
};

const SYSTEM_IDS = new Set(Object.keys(SYSTEM_KEYS));
const PROFILES = new Set(Object.keys(PROFILE_KEYS));
const MODES = new Set(Object.keys(MODE_KEYS));

export function systemControlLabel(id: AdvancedSystemId): string {
  return translateCurrent(SYSTEM_KEYS[id]);
}

export function systemControlProfileLabel(profile: ExperienceProfile): string {
  return translateCurrent(PROFILE_KEYS[profile]);
}

export function systemControlStatusLabel(
  system: { id: AdvancedSystemId; mode: SystemControlMode; source: SystemControlSource },
): string {
  return translateCurrent("season.automation.systemStatus", {
    system: systemControlLabel(system.id),
    mode: translateCurrent(MODE_KEYS[system.mode]),
    source: translateCurrent(SOURCE_KEYS[system.source]),
  });
}

export function systemControlCommandMessage(message: string): string {
  const [namespace, action, system, profile, mode] = message.split("|");
  if (namespace !== "system-control") return message;
  if (action === "invalid-system") return translateCurrent("season.automation.status.invalidSystem");
  if (action === "invalid-graduation") return translateCurrent("season.automation.status.invalidGraduation");
  if (action === "graduate" && PROFILES.has(system)) {
    return translateCurrent("season.automation.status.graduate", {
      profile: systemControlProfileLabel(system as ExperienceProfile),
    });
  }
  if (!SYSTEM_IDS.has(system)) return translateCurrent("season.automation.status.invalidSystem");
  const label = systemControlLabel(system as AdvancedSystemId);
  if (action === "take") return translateCurrent("season.automation.status.take", { system: label });
  if (action === "return" && PROFILES.has(profile) && MODES.has(mode)) {
    return translateCurrent("season.automation.status.return", {
      system: label,
      profile: systemControlProfileLabel(profile as ExperienceProfile),
      mode: translateCurrent(MODE_KEYS[mode as SystemControlMode]),
    });
  }
  return translateCurrent("season.automation.status.invalidSystem");
}

export function systemControlDecisionLabel(decision: string): string {
  const [namespace, kind, first, second, third, fourth] = decision.split("|");
  if (namespace !== "system-control") return decision;
  if (kind === "manual") return translateCurrent("season.automation.decision.manual");
  if (kind === "noop") {
    return translateCurrent("season.automation.decision.noop", { count: Number(first) || 0 });
  }
  if (kind === "commands" && first in PRESET_KEYS) {
    const systems = (second ?? "").split(",").filter((id) => SYSTEM_IDS.has(id));
    return translateCurrent("season.automation.decision.commands", {
      preset: translateCurrent(PRESET_KEYS[first as AutomationPreset]),
      systems: systems.map((id) => systemControlLabel(id as AdvancedSystemId)).join(", "),
    });
  }
  if (kind === "operations" && third in UPKEEP_KEYS) {
    return translateCurrent("season.automation.decision.operations", {
      open: Number(first) || 0,
      close: Number(second) || 0,
      upkeep: translateCurrent(UPKEEP_KEYS[third as FacilityUpkeepPolicy]),
      reserve: Number(fourth) || 0,
    });
  }
  if (kind === "recovery-policy") {
    return translateCurrent("season.automation.decision.recovery", {
      reasons: (first ?? "").split(",").filter(Boolean).join(", "),
      systems: (second ?? "").split(",").filter((id) => SYSTEM_IDS.has(id)).map((id) => systemControlLabel(id as AdvancedSystemId)).join(", "),
    });
  }
  return decision;
}
