import type { Course, World } from "../models/types";
import type { ArchitectureReviewData, ArchitectureReviewFilters } from "./review";

type ReviewBuilder = (course: Course, world: World, filters: ArchitectureReviewFilters) => ArchitectureReviewData;
interface ReviewTuple {
  course: Course;
  world: World;
  filters: ArchitectureReviewFilters;
  boundary: string;
  generation: number;
}
export interface ArchitectureReviewCapture {
  (): ArchitectureReviewData;
  /** Restore this mounted capture after passive cleanup; never build on setup. */
  resume(base?: ArchitectureReviewData): void;
}

/** One mounted App's current base result. Captured getters never switch tuples. */
export class ArchitectureReviewDemandOwner {
  private readonly build: ReviewBuilder;
  private current: ReviewTuple | undefined;
  private result: ArchitectureReviewData | undefined;
  private generation = 0;
  private retired = false;
  private building: { reentered: boolean } | undefined;

  constructor(build: ReviewBuilder) {
    this.build = build;
  }

  clear = (): void => {
    this.current = undefined;
    this.result = undefined;
    this.generation++;
  };

  retire = (): void => {
    this.retired = true;
    this.clear();
  };

  invalidateState(course: Course, world: World): void {
    if (this.current && (this.current.course !== course || this.current.world !== world)) this.clear();
  }

  capture(course: Course, world: World, filters: ArchitectureReviewFilters, boundary = "mounted"): ArchitectureReviewCapture {
    if (this.retired) throw new Error("Architecture review demand session has retired.");
    // Replayed memo calculators retain the first return: equal inputs must share
    // the very same tuple rather than invalidating that first captured getter.
    if (!this.current || this.current.course !== course || this.current.world !== world || this.current.filters !== filters || this.current.boundary !== boundary) {
      this.clear();
      this.current = { course, world, filters, boundary, generation: this.generation };
    }
    const tuple = this.current;
    const get = () => this.resolve(tuple, tuple.generation);
    get.resume = (base?: ArchitectureReviewData): void => {
      if (this.retired) return;
      // A stale setup cannot replace a newer render's current capture.
      if (this.current && this.current !== tuple) return;
      if (!this.current) {
        tuple.generation = this.generation;
        this.current = tuple;
      }
      // Eager base identity was already built by this render before effects.
      // Default setup passes no base and never invokes the cold builder.
      if (base !== undefined) this.result = base;
    };
    return get;
  }

  isCurrent(course: Course, world: World, filters: ArchitectureReviewFilters, base: ArchitectureReviewData): boolean {
    return this.current?.course === course && this.current.world === world && this.current.filters === filters && this.result === base;
  }

  private resolve(tuple: ReviewTuple, generation: number): ArchitectureReviewData {
    if (this.current === tuple && this.generation === generation && this.result) return this.result;
    if (this.building) {
      this.building.reentered = true;
      throw new Error("Architecture review demand cannot reenter its builder.");
    }
    const building = { reentered: false };
    this.building = building;
    try {
      // No catch: even falsy thrown values pass through unchanged and cannot publish.
      const result = this.build(tuple.course, tuple.world, tuple.filters);
      if (building.reentered) throw new Error("Architecture review demand cannot reenter its builder.");
      if (this.current === tuple && this.generation === generation) this.result = result;
      return result;
    } finally {
      this.building = undefined;
    }
  }
}
