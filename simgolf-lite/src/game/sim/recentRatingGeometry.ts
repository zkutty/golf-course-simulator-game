/** Synchronous memo ownership only: no returned entry is mutated or destroyed. */
export const RATING_GEOMETRY_HISTORY_LIMIT = 8;
export class RecentRatingGeometry<Entry extends object> {
  private completed: Entry[] = [];
  private failedPartial: Entry | undefined;
  private active: Entry[] = [];
  get completedSize(): number { return this.completed.length; }
  get failedPartialSize(): number { return this.failedPartial === undefined ? 0 : 1; }
  run<Result>(matches: (entry: Entry) => boolean, create: () => Entry, operation: (entry: Entry) => Result): Result {
    const cached = this.completed.find(matches);
    const entry = cached ?? this.active.find(matches)
      ?? (this.failedPartial && matches(this.failedPartial) ? this.failedPartial : undefined) ?? create();
    this.active.push(entry);
    let succeeded = false;
    try {
      const result = operation(entry);
      succeeded = true;
      return result;
    } finally {
      this.active.pop();
      // A nested setup may complete before the outer published rating fails.
      // Only its outermost required operation may evict completed history.
      if (!this.active.includes(entry)) {
        if (succeeded) {
          const index = this.completed.indexOf(entry);
          if (index >= 0) this.completed.splice(index, 1);
          this.completed.push(entry);
          if (this.completed.length > RATING_GEOMETRY_HISTORY_LIMIT) this.completed.shift();
          if (this.failedPartial === entry) this.failedPartial = undefined;
        } else if (!this.completed.includes(entry)) {
          // Keep the latest failed transaction's completed setup subparts for
          // an immediate retry, without accumulating failed-version history.
          this.failedPartial = entry;
        }
      }
    }
  }
}
