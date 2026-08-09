import type { SystemControlVisibility } from "../game/experience/systemControl";
import { LIVE } from "../game/live/liveConfig";

export type LiveOverviewTab = "golfers" | "leaderboard" | "staff" | "pace" | "mobility";

export function liveOverviewTabs(access: { pace: SystemControlVisibility; mobility: SystemControlVisibility }): LiveOverviewTab[] {
  const tabs: LiveOverviewTab[] = ["golfers", "leaderboard", "staff"];
  if (access.pace !== "hidden") tabs.push("pace");
  if (access.mobility === "full") tabs.push("mobility");
  return tabs;
}

export function formatStaffShiftMinute(minute: number): string {
  const normalized = ((Math.round(minute) + LIVE.day.displayStartHour * 60) % 1440 + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${hour12}:${String(normalized % 60).padStart(2, "0")} ${suffix}`;
}

export function staffShiftInputValue(minute: number): string {
  const normalized = Math.max(0, Math.min(1_439, Math.round(minute) + LIVE.day.displayStartHour * 60));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function staffShiftInputMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour >= 24 || minute >= 60) return null;
  const simulationMinute = hour * 60 + minute - LIVE.day.displayStartHour * 60;
  return simulationMinute >= LIVE.day.openMinute && simulationMinute <= LIVE.day.closeMinute ? simulationMinute : null;
}
