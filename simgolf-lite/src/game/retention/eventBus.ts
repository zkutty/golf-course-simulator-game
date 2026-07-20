import type { RetentionEvent, RetentionEventCategory } from "./types";

type Listener = (event: RetentionEvent) => void;
const listeners = new Set<Listener>();
const recent: RetentionEvent[] = [];
const lastByType = new Map<string, number>();
const perDay = new Map<string, number>();
const MAX_FEED = 50;
const MAX_PER_DAY = 12;

export function publishRetentionEvent(input: Omit<RetentionEvent, "id" | "createdAt">): RetentionEvent | null {
  const now = Date.now();
  const cooldown = input.severity === "routine" ? 8_000 : 1_000;
  const last = lastByType.get(input.type) ?? 0;
  if (now - last < cooldown) {
    const existing = recent.find((event) => event.type === input.type && event.week === input.week && event.day === input.day);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      existing.message = input.message;
      for (const listener of listeners) listener(existing);
    }
    return existing ?? null;
  }
  const dayKey = `${input.week}:${input.day}`;
  const dayCount = perDay.get(dayKey) ?? 0;
  if (dayCount >= MAX_PER_DAY && input.severity === "routine") return null;
  perDay.set(dayKey, dayCount + 1);
  lastByType.set(input.type, now);
  const event: RetentionEvent = { ...input, id: `${now}-${recent.length}`, createdAt: now };
  recent.unshift(event);
  recent.splice(MAX_FEED);
  for (const listener of listeners) listener(event);
  return event;
}

export function subscribeRetentionEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function retentionFeed(category?: RetentionEventCategory): RetentionEvent[] {
  return recent.filter((event) => !category || event.category === category).slice();
}

export function clearRetentionEventsForTests(): void {
  recent.length = 0;
  lastByType.clear();
  perDay.clear();
}
