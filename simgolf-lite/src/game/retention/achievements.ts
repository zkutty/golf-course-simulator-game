import type { AppProfile, EarnedAchievement } from "../onboarding/profile";
import type { Course, World } from "../models/types";
import type { CourseRecords } from "./types";
import { courseLayouts } from "../models/courseLayouts";

export type AchievementMetric = "holes" | "publishedHoles" | "courses" | "trees" | "cash" | "profit" | "rounds" | "aces" | "rating" | "reputation" | "tutorial" | "scenario" | "career" | "sculpt" | "loan" | "distress" | "mood";
export interface AchievementDefinition { id: string; icon: string; title: string; hint: string; metric: AchievementMetric; target: number; hidden?: boolean }

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: "first-hole", icon: "⛳", title: "Groundbreaker", hint: "Open your first playable hole.", metric: "holes", target: 1 },
  { id: "front-nine", icon: "9️⃣", title: "Front Nine", hint: "Publish nine unique, complete holes.", metric: "publishedHoles", target: 9 },
  { id: "full-eighteen", icon: "🏌️", title: "The Full Eighteen", hint: "Publish eighteen unique, complete holes.", metric: "publishedHoles", target: 18 },
  { id: "second-course", icon: "🗺️", title: "A Second Routing", hint: "Publish a second operating course.", metric: "courses", target: 2 },
  { id: "thirty-six-holes", icon: "🏰", title: "Thirty-Six Hole Estate", hint: "Publish 36 uniquely assigned holes.", metric: "publishedHoles", target: 36 },
  { id: "first-hill", icon: "⛰️", title: "Earth Mover", hint: "Sculpt your first hill.", metric: "sculpt", target: 1 },
  { id: "arboretum", icon: "🌲", title: "Arboretum", hint: "Plant 100 trees.", metric: "trees", target: 100 },
  { id: "first-profit", icon: "💵", title: "In the Black", hint: "Finish a profitable week.", metric: "profit", target: 1 },
  { id: "cash-100k", icon: "🏦", title: "War Chest", hint: "Hold $100,000 in cash.", metric: "cash", target: 100000 },
  { id: "loan-repaid", icon: "📜", title: "Free and Clear", hint: "Repay a loan in full.", metric: "loan", target: 1 },
  { id: "distress-survivor", icon: "🛟", title: "Back From the Brink", hint: "Recover after a distress week.", metric: "distress", target: 1 },
  { id: "first-ace", icon: "🎯", title: "Witness to History", hint: "Host a hole-in-one.", metric: "aces", target: 1 },
  { id: "under-par", icon: "🐦", title: "Red Numbers", hint: "Set a course record under par.", metric: "rating", target: 1 },
  { id: "rounds-100", icon: "👥", title: "Local Favorite", hint: "Host 100 rounds.", metric: "rounds", target: 100 },
  { id: "rounds-1000", icon: "🎟️", title: "Turnstile Tycoon", hint: "Host 1,000 rounds.", metric: "rounds", target: 1000 },
  { id: "rep-50", icon: "⭐", title: "Known Around Town", hint: "Reach 50 reputation.", metric: "reputation", target: 50 },
  { id: "rep-80", icon: "🌟", title: "Destination Course", hint: "Reach 80 reputation.", metric: "reputation", target: 80 },
  { id: "rating-72", icon: "🏆", title: "Championship Test", hint: "Reach a 72 course rating.", metric: "rating", target: 72 },
  { id: "perfect-mood", icon: "😊", title: "Perfect Foursome", hint: "Finish a round in perfect spirits.", metric: "mood", target: 1 },
  { id: "tutorial", icon: "🎓", title: "Course Graduate", hint: "Finish the tutorial.", metric: "tutorial", target: 1 },
  { id: "scenario", icon: "🗺️", title: "Scenario Winner", hint: "Complete a scenario.", metric: "scenario", target: 1 },
  { id: "career", icon: "👑", title: "CourseCraft Legend", hint: "Finish the career ladder.", metric: "career", target: 1 },
  { id: "hidden-ace-pair", icon: "❓", title: "Lightning Twice", hint: "Host two aces.", metric: "aces", target: 2, hidden: true },
  { id: "hidden-profit-ten", icon: "❓", title: "Metronome", hint: "Post ten profitable weeks in a row.", metric: "profit", target: 10, hidden: true },
  { id: "hidden-forest", icon: "❓", title: "Lost in the Woods", hint: "Plant 250 trees.", metric: "trees", target: 250, hidden: true },
  { id: "hidden-million", icon: "❓", title: "Clubhouse Millionaire", hint: "Hold $1,000,000.", metric: "cash", target: 1000000, hidden: true },
  { id: "hidden-rounds", icon: "❓", title: "Everybody Plays", hint: "Host 5,000 rounds.", metric: "rounds", target: 5000, hidden: true },
];

export interface AchievementContext { course: Course; world: World; records: CourseRecords; rating: number; tutorialCompleted: boolean; profitStreak: number; sculpted: boolean; recoveredDistress: boolean; perfectMood: boolean }

export function achievementProgress(definition: AchievementDefinition, context: AchievementContext): number {
  switch (definition.metric) {
    case "holes": return context.course.holes.filter((hole) => hole.tee && hole.green).length;
    case "publishedHoles": {
      const complete = new Set(context.course.holes.filter((hole) => hole.id && hole.tee && hole.green).map((hole) => hole.id!));
      return new Set(courseLayouts(context.course).flatMap((layout) => layout.publishedHoleIds).filter((id) => complete.has(id))).size;
    }
    case "courses": return courseLayouts(context.course).filter((layout) => layout.publishedHoleIds.length === layout.roundLength).length;
    case "trees": return context.course.obstacles.filter((obstacle) => obstacle.type === "tree").length;
    case "cash": return Math.max(0, context.world.cash);
    case "profit": return definition.id === "hidden-profit-ten" ? context.profitStreak : context.world.lastWeekProfit > 0 ? 1 : 0;
    case "rounds": return context.records.totalRounds;
    case "aces": return context.records.aces.length;
    case "rating": return definition.id === "under-par" ? context.records.bestRound && context.records.bestRound.scoreToPar < 0 ? 1 : 0 : context.course.holes.some((hole) => hole.tee && hole.green) ? context.rating : 0;
    case "reputation": return context.world.reputation;
    case "tutorial": return context.tutorialCompleted ? 1 : 0;
    case "scenario": return context.world.objectives?.outcome === "WON" ? 1 : 0;
    case "career": return context.world.mode === "career" && context.world.objectives?.outcome === "WON" && context.world.scenarioId === "championship-dream" ? 1 : 0;
    case "sculpt": return context.sculpted ? 1 : 0;
    case "loan": return context.world.loans.some((loan) => loan.status === "PAID") ? 1 : 0;
    case "distress": return context.recoveredDistress ? 1 : 0;
    case "mood": return context.perfectMood ? 1 : 0;
  }
}

export function evaluateAchievements(profile: AppProfile, context: AchievementContext, courseName: string, now = Date.now()): { profile: AppProfile; earned: AchievementDefinition[] } {
  const known = new Set(profile.achievements.earned.map((entry) => entry.id));
  const earned = ACHIEVEMENTS.filter((definition) => !known.has(definition.id) && achievementProgress(definition, context) >= definition.target);
  const additions: EarnedAchievement[] = earned.map((definition) => ({ id: definition.id, earnedAt: now, courseName }));
  return { profile: { ...profile, achievements: { earned: [...profile.achievements.earned, ...additions] } }, earned };
}
