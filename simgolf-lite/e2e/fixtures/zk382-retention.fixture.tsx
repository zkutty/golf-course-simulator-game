import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RetentionHub } from "../../src/ui/retention/RetentionHub";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { DEFAULT_APP_PROFILE } from "../../src/game/onboarding/profile";
import { emptyCourseRecords } from "../../src/game/retention/records";
import type { HistoryPoint } from "../../src/game/retention/types";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import "../../src/index.css";

const variant = new URLSearchParams(location.search).get("state") ?? "normal";
const course = structuredClone(DEFAULT_COURSE);
const world = structuredClone(DEFAULT_WORLD);
const profile = structuredClone(DEFAULT_APP_PROFILE);
const records = emptyCourseRecords(2);
const longName = "Morgan " + "Longname".repeat(8);
records.history = [[1, 1500, 61.5, 30.1, -100, 9], [2, 1600, 62.5, 32.2, 200, 11], [3, 1400, 60.1, 33.3, -50, 13], [4, 1800, 67.8, 40.4, 300, 15]];
records.bestRound = { scoreToPar: -3, score: 69, golferName: longName, golferId: 1, week: 4 };
records.aces = [{ golferName: longName, golferId: 1, holeIndex: 0, holeId: "alpha-hole", courseId: "alpha", week: 2, archetype: "senior" }, { golferName: "Casey", golferId: 2, holeIndex: 1, holeId: "beta-hole", courseId: "beta", week: 3, archetype: "senior" }];
records.recordRevenue = { amount: 123456, week: 4 };
records.attendanceRecord = { rounds: 1234, week: 4 };
records.longestProfitStreak = 7;
records.totalRounds = 1234;
records.holes = [{ rounds: 2, strokes: 15, par: 7 }, { rounds: 3, strokes: 19, par: 9 }];
records.hall = [{ golferName: longName, golferId: 1, archetype: "senior", rounds: 1234, bestToPar: -3, aces: 2 }, { golferName: "Casey", golferId: 2, archetype: "lowHandicap", rounds: 42, bestToPar: -1, aces: 1 }];
records.byCourse = {
  alpha: { courseName: "Alpha " + "Longcourse".repeat(8), totalRounds: 123, bestRound: { scoreToPar: -1, score: 71, golferName: "Casey", golferId: 2, week: 2 }, holes: { "alpha-hole": { rounds: 2, strokes: 13, par: 7 } } },
  beta: { courseName: "Beta authored course", totalRounds: 45, bestRound: null, holes: { "beta-hole": { rounds: 2, strokes: 17, par: 7 } } },
};
profile.achievements.earned = [{ id: "first-hole", earnedAt: 1, courseName: "Authored course" }];
if (variant === "hidden-earned") profile.achievements.earned.push({ id: "hidden-ace-pair", earnedAt: 2, courseName: "Authored course" });
if (variant === "empty") Object.assign(records, emptyCourseRecords(2));
if (variant === "fractional") records.history = [[1, 1500.123456789, 61.123456789, 30.123456789, -100.87654321, 9], [2, -1500.87654321, 62.87654321, 32.87654321, 200.123456789, 11]];
if (variant === "one") records.history = [records.history[0]];
if (variant === "long") records.history = Array.from({ length: 220 }, (_, i): HistoryPoint => [i + 1, 1000 + i * 100, 60 + i / 10, 20 + i / 10, i === 0 ? 0 : i % 2 ? i * 10 : -i * 10, i + 1]);
world.cash = 50000;
const context = { course, world, records, rating: 62.5, tutorialCompleted: false, profitStreak: 3, sculpted: false, recoveredDistress: false, perfectMood: false };
const initial = JSON.stringify({ records, profile, context });

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [closeCount, setCloseCount] = useState(0);
  Object.assign(window, { retentionFixture: { records, profile, context } });
  return <><button data-testid="opener" onClick={() => setOpen(true)}>Open records</button><button data-testid="outside">Outside control</button>
    <output hidden data-testid="close-count">{closeCount}</output><output hidden data-testid="immutable">{String(initial === JSON.stringify({ records, profile, context }))}</output>
    {open && <RetentionHub records={records} profile={profile} context={context} onClose={() => { setCloseCount(count => count + 1); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
