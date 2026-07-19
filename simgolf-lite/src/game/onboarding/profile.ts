export type AdvisorFrequency = "chatty" | "normal" | "important" | "off";

export interface AppProfile {
  tutorialOffered: boolean;
  tutorialCompleted: boolean;
  advisorFrequency: AdvisorFrequency;
}
const PROFILE_KEY = "coursecraft_app_profile_v1";

const DEFAULT_PROFILE: AppProfile = {
  tutorialOffered: false,
  tutorialCompleted: false,
  advisorFrequency: "normal",
};

export function loadAppProfile(): AppProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null") as Partial<AppProfile> | null;
    if (!parsed) return DEFAULT_PROFILE;
    const frequency = parsed.advisorFrequency;
    return {
      tutorialOffered: parsed.tutorialOffered === true,
      tutorialCompleted: parsed.tutorialCompleted === true,
      advisorFrequency:
        frequency === "chatty" || frequency === "normal" || frequency === "important" || frequency === "off"
          ? frequency
          : "normal",
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveAppProfile(profile: AppProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent("coursecraft-profile-change", { detail: profile }));
}

export function updateAppProfile(patch: Partial<AppProfile>): AppProfile {
  const next = { ...loadAppProfile(), ...patch };
  saveAppProfile(next);
  return next;
}
