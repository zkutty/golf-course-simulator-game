import type { Course, WeekResult, World } from "../models/types";
import { operatingCourseViews } from "../models/courseLayouts";
import { computeCourseRatingAndSlope } from "./courseRating";
import { scoreCourseHoles } from "./holes";
import { demandIndex } from "./score";
import { plannedGolfersForDay } from "../live/demand";

export interface CourseOperationalMetrics {
  courseId: string;
  name: string;
  greenFee: number;
  holes: number;
  rating: number;
  slope: number;
  quality: number;
  demand: number;
  dailyVisitors: number;
  dailyCapacity: number;
}

export function courseOperationalMetrics(course: Course, world: World, courseId?: string): CourseOperationalMetrics[] {
  return operatingCourseViews(course).filter(({ layout }) => !courseId || layout.id === courseId).map(({ layout, course: view }) => {
    const rating = computeCourseRatingAndSlope(view);
    const score = scoreCourseHoles(view);
    return {
      courseId: layout.id,
      name: layout.name,
      greenFee: layout.greenFee,
      holes: view.holes.length,
      rating: rating.courseRating,
      slope: rating.slope,
      quality: score.courseQuality,
      demand: demandIndex(view, world),
      dailyVisitors: plannedGolfersForDay(view, world),
      dailyCapacity: layout.roundLength * 4,
    };
  });
}

export function perCourseTotalsReconcile(result: WeekResult): boolean {
  if (!result.perCourse?.length) return true;
  const sum = (key: "revenue" | "costs" | "profit") => result.perCourse!.reduce((total, row) => total + row[key], 0);
  return Math.abs(sum("revenue") - result.revenue) < .01 && Math.abs(sum("costs") - result.costs) < .01 && Math.abs(sum("profit") - result.profit) < .01;
}
