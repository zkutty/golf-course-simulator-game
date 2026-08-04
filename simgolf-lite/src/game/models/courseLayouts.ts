import type { Course, CourseLayout, Hole } from "./types";
import { scoreCourseHoles } from "../sim/holes";
import { normalizeOperations } from "./courseOperations";

export const MAX_ESTATE_HOLES = 36;

/** Deterministic handicap ranking: modeled bogey-minus-scratch gap descends;
 * ties use stable hole identity then route position. Eighteen-hole routes put
 * the nine largest gaps on odd indexes before allocating even indexes. */
export function automaticStrokeIndexes(course: Course): number[] | null {
  if (course.holes.length !== 9 && course.holes.length !== 18) return null;
  const summary = scoreCourseHoles(course);
  return rankStrokeIndexes(course.holes.map((hole, index) => ({
    id: hole.id ?? "",
    gap: (summary.holes[index]?.bogeyShotsToGreen ?? -Infinity) - (summary.holes[index]?.scratchShotsToGreen ?? Infinity),
  })));
}

function rankStrokeIndexes(values: readonly { id: string; gap: number }[]): number[] | null {
  if (values.length !== 9 && values.length !== 18) return null;
  const ranked = values.map((value, index) => ({
    index,
    ...value,
  })).sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id) || a.index - b.index);
  const indexes = new Array<number>(values.length);
  if (values.length === 9) ranked.forEach((entry, rank) => { indexes[entry.index] = rank + 1; });
  else {
    ranked.slice(0, 9).forEach((entry, rank) => { indexes[entry.index] = rank * 2 + 1; });
    ranked.slice(9).forEach((entry, rank) => { indexes[entry.index] = rank * 2 + 2; });
  }
  return indexes;
}

function withPublishedAutomaticStrokeIndexes(course: Course, courseId: string): Course {
  const layout = layoutById(course, courseId);
  if (!layout) return course;
  const view = courseForLayout(course, courseId, true);
  const indexes = automaticStrokeIndexes(view);
  if (!indexes) return course;
  const indexById = new Map(view.holes.map((hole, index) => [hole.id!, indexes[index]]));
  const manualIndexes = new Set(view.holes
    .filter((hole) => hole.holeIndexSource === "manual" && Number.isInteger(hole.holeIndex) && (hole.holeIndex as number) >= 1 && (hole.holeIndex as number) <= view.holes.length)
    .map((hole) => hole.holeIndex as number));
  const availableIndexes = Array.from({ length: view.holes.length }, (_, index) => index + 1)
    .filter((index) => !manualIndexes.has(index));
  const automaticIds = view.holes
    .filter((hole) => hole.holeIndexSource !== "manual")
    .sort((a, b) => (indexById.get(a.id!) ?? Infinity) - (indexById.get(b.id!) ?? Infinity) || a.id!.localeCompare(b.id!))
    .map((hole) => hole.id!);
  const assignedAutomaticIndexes = new Map(automaticIds.map((id, index) => [id, availableIndexes[index]]));
  const holes = course.holes.map((hole) => {
    if (!hole.id || hole.holeIndexSource === "manual" || !assignedAutomaticIndexes.has(hole.id)) return hole;
    return { ...hole, holeIndex: assignedAutomaticIndexes.get(hole.id), holeIndexSource: "auto" as const };
  });
  return { ...course, holes };
}

// Course state is updated immutably throughout the reducer. Preserve one
// normalized object and one published/draft view per revision so downstream
// scoring WeakMaps keep working across repeated layout lookups.
const normalizedCourseCache = new WeakMap<Course, Course>();
const layoutViewCache = new WeakMap<Course, Map<string, Course>>();

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "course";
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

export function normalizeCourseLayouts(input: Course): Course {
  const cached = normalizedCourseCache.get(input);
  if (cached) return cached;
  const usedHoleIds = new Set<string>();
  const normalizedHoles = input.holes.slice(0, MAX_ESTATE_HOLES).map((hole, index) => {
    const id = uniqueId(typeof hole.id === "string" && hole.id.trim() ? hole.id.trim() : `hole-${index + 1}`, usedHoleIds);
    const holeIndexSource = hole.holeIndexSource === "auto" || hole.holeIndexSource === "manual" || hole.holeIndexSource === "legacy"
      ? hole.holeIndexSource
      : Number.isInteger(hole.holeIndex) ? "legacy" as const : undefined;
    return hole.id === id && hole.holeIndexSource === holeIndexSource ? hole : { ...hole, id, ...(holeIndexSource ? { holeIndexSource } : {}) };
  });
  const holes = normalizedHoles.length === input.holes.length &&
    normalizedHoles.every((hole, index) => hole === input.holes[index])
    ? input.holes
    : normalizedHoles;
  const holeIds = new Set(holes.map((hole) => hole.id!));
  const usedLayoutIds = new Set<string>();
  const normalized: CourseLayout[] = [];
  for (const raw of input.layouts ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const id = uniqueId(typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `course-${normalized.length + 1}`, usedLayoutIds);
    const clean = (values: unknown): string[] => Array.isArray(values)
      ? [...new Set(values.filter((value): value is string => typeof value === "string" && holeIds.has(value)))]
      : [];
    const draftHoleIds = clean(raw.draftHoleIds);
    const publishedHoleIds = clean(raw.publishedHoleIds);
    normalized.push({
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Course ${normalized.length + 1}`,
      draftHoleIds,
      publishedHoleIds,
      roundLength: raw.roundLength === 18 ? 18 : 9,
      state: raw.state === "closed" ? "closed" : "open",
      greenFee: Number.isFinite(raw.greenFee) ? Math.max(0, Math.round(raw.greenFee)) : input.baseGreenFee,
      operations: normalizeOperations(raw.operations),
      legacyPartial: raw.legacyPartial === true || undefined,
    });
  }
  if (normalized.length === 0) {
    const all = holes.map((hole) => hole.id!);
    normalized.push({
      id: "course-primary",
      name: input.name,
      draftHoleIds: all,
      publishedHoleIds: all,
      roundLength: all.length >= 18 ? 18 : 9,
      state: "open",
      greenFee: input.baseGreenFee,
      operations: normalizeOperations(),
      legacyPartial: all.length !== 9 && all.length !== 18 ? true : undefined,
    });
    usedLayoutIds.add("course-primary");
  }
  // Published ownership is authoritative. A duplicated legacy reference is
  // retained only on its first owner so one physical hole never operates twice.
  const publishedOwner = new Set<string>();
  const layouts = normalized.map((layout) => ({
    ...layout,
    publishedHoleIds: layout.publishedHoleIds.filter((id) => {
      if (publishedOwner.has(id)) return false;
      publishedOwner.add(id);
      return true;
    }),
  }));
  const activeCourseId = layouts.some((layout) => layout.id === input.activeCourseId)
    ? input.activeCourseId
    : layouts[0].id;
  const active = layouts.find((layout) => layout.id === activeCourseId)!;
  const result = { ...input, holes, layouts, activeCourseId, baseGreenFee: active.greenFee };
  normalizedCourseCache.set(input, result);
  normalizedCourseCache.set(result, result);
  return result;
}

export function courseLayouts(course: Course): CourseLayout[] {
  return normalizeCourseLayouts(course).layouts!;
}

export function activeCourseLayout(course: Course): CourseLayout {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts!.find((layout) => layout.id === normalized.activeCourseId) ?? normalized.layouts![0];
}

export function layoutById(course: Course, courseId?: string): CourseLayout | undefined {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts!.find((layout) => layout.id === courseId) ?? (courseId == null ? activeCourseLayout(normalized) : undefined);
}

export function courseForLayout(course: Course, courseId?: string, draft = false): Course {
  const normalized = normalizeCourseLayouts(course);
  const layout = layoutById(normalized, courseId) ?? activeCourseLayout(normalized);
  let views = layoutViewCache.get(normalized);
  if (!views) {
    views = new Map();
    layoutViewCache.set(normalized, views);
  }
  const cacheKey = `${layout.id}:${draft ? "draft" : "published"}`;
  const cached = views.get(cacheKey);
  if (cached) return cached;
  const ids = draft ? layout.draftHoleIds : layout.publishedHoleIds;
  const byId = new Map(normalized.holes.map((hole) => [hole.id!, hole]));
  const result = {
    ...normalized,
    name: layout.name,
    holes: ids.map((id) => byId.get(id)).filter((hole): hole is Hole => !!hole),
    baseGreenFee: layout.greenFee,
    activeCourseId: layout.id,
  };
  views.set(cacheKey, result);
  return result;
}

export function courseForHoleIds(course: Course, holeIds: readonly string[], courseId?: string): Course {
  const normalized = normalizeCourseLayouts(course);
  const byId = new Map(normalized.holes.map((hole) => [hole.id!, hole]));
  const layout = layoutById(normalized, courseId);
  return {
    ...normalized,
    name: layout?.name ?? normalized.name,
    holes: holeIds.map((id) => byId.get(id)).filter((hole): hole is Hole => !!hole),
    baseGreenFee: layout?.greenFee ?? normalized.baseGreenFee,
  };
}

export function operatingCourseViews(course: Course): Array<{ layout: CourseLayout; course: Course }> {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts!
    .filter((layout) => layout.state === "open" && layout.publishedHoleIds.length > 0)
    .map((layout) => ({ layout, course: courseForLayout(normalized, layout.id) }));
}

export interface RoutingValidation { valid: boolean; reasons: string[] }

export function validateDraftRouting(course: Course, courseId: string): RoutingValidation {
  const normalized = normalizeCourseLayouts(course);
  const layout = layoutById(normalized, courseId);
  if (!layout) return { valid: false, reasons: ["Course not found."] };
  const reasons: string[] = [];
  if (layout.draftHoleIds.length !== 9 && layout.draftHoleIds.length !== 18) reasons.push("Routing must contain exactly 9 or 18 holes.");
  if (new Set(layout.draftHoleIds).size !== layout.draftHoleIds.length) reasons.push("Each hole may appear only once in a routing.");
  const otherAssigned = new Set(normalized.layouts!.filter((candidate) => candidate.id !== layout.id).flatMap((candidate) => candidate.draftHoleIds));
  const duplicates = layout.draftHoleIds.filter((id) => otherAssigned.has(id));
  if (duplicates.length) reasons.push(`${duplicates.length} hole${duplicates.length === 1 ? " is" : "s are"} assigned to another course.`);
  const draft = courseForLayout(normalized, layout.id, true);
  const score = scoreCourseHoles(draft);
  score.holes.forEach((hole, index) => {
    if (!hole.isComplete) reasons.push(`Hole ${index + 1} is incomplete.`);
    else if (!hole.isValid) reasons.push(`Hole ${index + 1} is not playable.`);
  });
  return { valid: reasons.length === 0, reasons };
}

export function createLayout(course: Course, name?: string): Course {
  const normalized = normalizeCourseLayouts(course);
  const used = new Set(normalized.layouts!.map((layout) => layout.id));
  const label = name?.trim() || `Course ${normalized.layouts!.length + 1}`;
  const id = uniqueId(`course-${slug(label)}`, used);
  const layout: CourseLayout = { id, name: label, draftHoleIds: [], publishedHoleIds: [], roundLength: 9, state: "closed", greenFee: normalized.baseGreenFee, operations: normalizeOperations() };
  return { ...normalized, layouts: [...normalized.layouts!, layout], activeCourseId: id, baseGreenFee: layout.greenFee };
}

export function addEstateHole(course: Course, courseId: string): Course {
  const normalized = normalizeCourseLayouts(course);
  if (normalized.holes.length >= MAX_ESTATE_HOLES) return normalized;
  const used = new Set(normalized.holes.map((hole) => hole.id!));
  const id = uniqueId(`hole-${normalized.holes.length + 1}`, used);
  const hole: Hole = { id, tee: null, green: null, teeBoxes: { forward: null, member: null, championship: null }, pinPositions: { A: null, B: null, C: null }, parMode: "AUTO", name: `Hole ${normalized.holes.length + 1}` };
  return assignHoleToLayout({ ...normalized, holes: [...normalized.holes, hole] }, courseId, id);
}

export function updateLayout(course: Course, courseId: string, patch: Partial<Pick<CourseLayout, "name" | "draftHoleIds" | "state" | "greenFee" | "operations">>): Course {
  const normalized = normalizeCourseLayouts(course);
  const validIds = new Set(normalized.holes.map((hole) => hole.id!));
  const layouts = normalized.layouts!.map((layout) => layout.id !== courseId ? layout : {
    ...layout,
    ...(patch.name != null ? { name: patch.name.trim() || layout.name } : {}),
    ...(patch.state != null ? { state: patch.state } : {}),
    ...(patch.greenFee != null ? { greenFee: Math.max(0, Math.round(patch.greenFee)) } : {}),
    ...(patch.operations != null ? { operations: normalizeOperations(patch.operations) } : {}),
    ...(patch.draftHoleIds != null ? { draftHoleIds: [...new Set(patch.draftHoleIds.filter((id) => validIds.has(id)))] } : {}),
  });
  const active = layouts.find((layout) => layout.id === normalized.activeCourseId) ?? layouts[0];
  const result = { ...normalized, layouts, baseGreenFee: active.greenFee };
  normalizedCourseCache.set(result, result);
  return result;
}

export function assignHoleToLayout(course: Course, courseId: string, holeId: string): Course {
  const normalized = normalizeCourseLayouts(course);
  if (!normalized.holes.some((hole) => hole.id === holeId)) return normalized;
  const layouts = normalized.layouts!.map((layout) => ({
    ...layout,
    draftHoleIds: layout.id === courseId
      ? layout.draftHoleIds.includes(holeId) ? layout.draftHoleIds : [...layout.draftHoleIds, holeId]
      : layout.draftHoleIds.filter((id) => id !== holeId),
  }));
  return { ...normalized, layouts };
}

export function publishLayout(course: Course, courseId: string): { course: Course; reasons: string[] } {
  const normalized = normalizeCourseLayouts(course);
  const validation = validateDraftRouting(normalized, courseId);
  if (!validation.valid) return { course: normalized, reasons: validation.reasons };
  const ranked = withPublishedAutomaticStrokeIndexes(normalized, courseId);
  const layouts = ranked.layouts!.map((layout) => layout.id === courseId
    ? { ...layout, publishedHoleIds: [...layout.draftHoleIds], roundLength: layout.draftHoleIds.length as 9 | 18, state: "open" as const, legacyPartial: undefined }
    : layout);
  return { course: { ...ranked, layouts }, reasons: [] };
}

export function selectLayout(course: Course, courseId: string): Course {
  const normalized = normalizeCourseLayouts(course);
  const layout = normalized.layouts!.find((candidate) => candidate.id === courseId);
  return layout ? { ...normalized, activeCourseId: layout.id, baseGreenFee: layout.greenFee } : normalized;
}
