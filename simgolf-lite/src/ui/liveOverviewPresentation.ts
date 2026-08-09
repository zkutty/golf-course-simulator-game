import type { SystemControlVisibility } from "../game/experience/systemControl";

export type LiveOverviewTab = "golfers" | "leaderboard" | "staff" | "pace" | "mobility";

export function liveOverviewTabs(access: { pace: SystemControlVisibility; mobility: SystemControlVisibility }): LiveOverviewTab[] {
  const tabs: LiveOverviewTab[] = ["golfers", "leaderboard", "staff"];
  if (access.pace !== "hidden") tabs.push("pace");
  if (access.mobility === "full") tabs.push("mobility");
  return tabs;
}

export function formatStaffShiftMinute(minute: number): string {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${hour12}:${String(normalized % 60).padStart(2, "0")} ${suffix}`;
}
