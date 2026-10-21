/** Public, source-faithful shot-distance observations. This is not runtime calibration. */
export const DISTANCE_BENCHMARK_CORPUS_VERSION = 1 as const;
export const DISTANCE_BENCHMARK_EXTRACTION_DATE = "2026-10-21" as const;

export type DistanceSourceId = "arccos-2020-smart-distance" | "shotscope-data-booklet";
export type DistanceMetric = "median" | "performance_average";
export type DistanceCarryStatus = "carry" | "total" | "unspecified";

export interface DistanceBenchmarkSource {
  readonly id: DistanceSourceId;
  readonly title: string;
  readonly url: string;
  readonly publicationDate: string | null;
  readonly dataPeriod: string | null;
  readonly population: string;
  readonly sampleSize: number | null;
  readonly reuseNotes: string;
}

export interface DistanceBenchmarkObservation {
  readonly sourceId: DistanceSourceId;
  readonly sourcePage: string;
  readonly extractedAt: string;
  readonly club: string | null;
  readonly loftDegrees: number | null;
  readonly shotContext: string;
  readonly handicapLabel: string;
  readonly handicapValue: number | null;
  readonly handicapBand: readonly [number, number] | null;
  readonly value: number;
  readonly unit: "yd";
  readonly metric: DistanceMetric;
  readonly carryStatus: DistanceCarryStatus;
  readonly population: string;
  readonly sampleSize: number | null;
  readonly uncertainty: string | null;
}

export const DISTANCE_BENCHMARK_SOURCES: readonly DistanceBenchmarkSource[] = Object.freeze([
  {
    id: "arccos-2020-smart-distance",
    title: "Want Rapid Golf Game Improvement? Smart Distance Club Averages Are Key",
    url: "https://ca.arccosgolf.com/blogs/community/arccos-caddie-smart-distances-provide-rapid-golf-game-improvement",
    publicationDate: "2020-04-24",
    dataPeriod: null,
    population: "Arccos users; club-level observations grouped at scratch, 10 handicap, and 20 handicap; further cohort details unspecified",
    sampleSize: null,
    reuseNotes: "Public article excerpted as individual factual observations; not a complete dataset. Preserve Arccos Smart Distance definition and do not imply carry.",
  },
  {
    id: "shotscope-data-booklet",
    title: "Transform Your Game & Save 4.1 Shots",
    url: "https://shotscope.com/assets/Shot-Scope-Data-Booklet-low-res-1.pdf",
    publicationDate: null,
    dataPeriod: null,
    population: "Shot Scope performance-tracking users; booklet describes a database of over 350 million shots; exact distance-cohort sample sizes unspecified",
    sampleSize: null,
    reuseNotes: "Public booklet provides six P-Avg off-tee anchors; retain filtered-average metric and unspecified carry/total status.",
  },
] as const);

const arccosPopulation = DISTANCE_BENCHMARK_SOURCES[0].population;
const shotScopePopulation = DISTANCE_BENCHMARK_SOURCES[1].population;
const observations: DistanceBenchmarkObservation[] = [
  ...([159, 148, 140] as const).map((value, index) => ({ sourceId: "arccos-2020-smart-distance" as const, sourcePage: "article, 7-iron paragraph", extractedAt: DISTANCE_BENCHMARK_EXTRACTION_DATE, club: "7-iron", loftDegrees: null, shotContext: "club distance; actual distance hit", handicapLabel: (["scratch", "10 handicap", "20 handicap"] as const)[index], handicapValue: ([0, 10, 20] as const)[index], handicapBand: null, value, unit: "yd" as const, metric: "median" as const, carryStatus: "unspecified" as const, population: arccosPopulation, sampleSize: null, uncertainty: null })),
  ...([122, 114, 104] as const).map((value, index) => ({ sourceId: "arccos-2020-smart-distance" as const, sourcePage: "article, pitching-wedge paragraph", extractedAt: DISTANCE_BENCHMARK_EXTRACTION_DATE, club: "pitching wedge", loftDegrees: null, shotContext: "club distance; actual distance hit", handicapLabel: (["scratch", "10 handicap", "20 handicap"] as const)[index], handicapValue: ([0, 10, 20] as const)[index], handicapBand: null, value, unit: "yd" as const, metric: "median" as const, carryStatus: "unspecified" as const, population: arccosPopulation, sampleSize: null, uncertainty: null })),
  ...([285, 259, 256, 238, 225, 204] as const).map((value, index) => ({ sourceId: "shotscope-data-booklet" as const, sourcePage: "printed p. 10 / PDF p. 6, Off the Tee", extractedAt: DISTANCE_BENCHMARK_EXTRACTION_DATE, club: null, loftDegrees: null, shotContext: "off the tee", handicapLabel: (["scratch", "5 handicap", "10 handicap", "15 handicap", "20 handicap", "25 handicap"] as const)[index], handicapValue: ([0, 5, 10, 15, 20, 25] as const)[index], handicapBand: null, value, unit: "yd" as const, metric: "performance_average" as const, carryStatus: "unspecified" as const, population: shotScopePopulation, sampleSize: null, uncertainty: null })),
];

export const DISTANCE_BENCHMARK_OBSERVATIONS: readonly DistanceBenchmarkObservation[] = Object.freeze(observations.map((row) => Object.freeze({ ...row })));

const sourceIds = new Set<string>(DISTANCE_BENCHMARK_SOURCES.map((source) => source.id));
const validMetrics = new Set<string>(["median", "performance_average"]);
const validCarryStatuses = new Set<string>(["carry", "total", "unspecified"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function isDistanceBenchmarkSource(value: unknown): value is DistanceBenchmarkSource {
  const keys = ["id", "title", "url", "publicationDate", "dataPeriod", "population", "sampleSize", "reuseNotes"] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) || typeof value.id !== "string" || !sourceIds.has(value.id)) return false;
  if (!["title", "url", "population", "reuseNotes"].every((key) => typeof value[key] === "string" && value[key] !== "")) return false;
  if (!/^https:\/\//.test(value.url as string)) return false;
  if (value.publicationDate !== null && !isDate(value.publicationDate)) return false;
  if (value.dataPeriod !== null && typeof value.dataPeriod !== "string") return false;
  return value.sampleSize === null || (typeof value.sampleSize === "number" && Number.isInteger(value.sampleSize) && value.sampleSize > 0);
}

/** Strict runtime validator for imported/edited corpus records. */
export function isDistanceBenchmarkObservation(value: unknown): value is DistanceBenchmarkObservation {
  const keys = ["sourceId", "sourcePage", "extractedAt", "club", "loftDegrees", "shotContext", "handicapLabel", "handicapValue", "handicapBand", "value", "unit", "metric", "carryStatus", "population", "sampleSize", "uncertainty"] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) return false;
  if (typeof value.sourceId !== "string" || !sourceIds.has(value.sourceId)) return false;
  if (!["sourcePage", "extractedAt", "shotContext", "handicapLabel", "population"].every((key) => typeof value[key] === "string" && value[key] !== "")) return false;
  if (value.club !== null && typeof value.club !== "string") return false;
  if (value.loftDegrees !== null && (typeof value.loftDegrees !== "number" || !Number.isFinite(value.loftDegrees) || value.loftDegrees <= 0)) return false;
  if (value.handicapValue !== null && (typeof value.handicapValue !== "number" || !Number.isFinite(value.handicapValue) || value.handicapValue < 0)) return false;
  if (value.handicapBand !== null && (!Array.isArray(value.handicapBand) || value.handicapBand.length !== 2 || value.handicapBand.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0) || value.handicapBand[0] > value.handicapBand[1])) return false;
  if (typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0) return false;
  if (value.unit !== "yd" || typeof value.metric !== "string" || !validMetrics.has(value.metric)) return false;
  if (typeof value.carryStatus !== "string" || !validCarryStatuses.has(value.carryStatus)) return false;
  if ((value.sourceId === "arccos-2020-smart-distance" && (value.metric !== "median" || value.carryStatus !== "unspecified")) || (value.sourceId === "shotscope-data-booklet" && (value.metric !== "performance_average" || value.carryStatus !== "unspecified"))) return false;
  if (value.sampleSize !== null && (typeof value.sampleSize !== "number" || !Number.isInteger(value.sampleSize) || value.sampleSize <= 0)) return false;
  if (value.uncertainty !== null && typeof value.uncertainty !== "string") return false;
  if (!isDate(value.extractedAt)) return false;
  return true;
}

/** Source records describe publication metadata only; they are not fitted values. */
export const ARCCOS_2026_SOURCE_METADATA = Object.freeze({
  title: "Average Driving Distance by Age, Gender & Skill — New Arccos Driving Distance Data Report",
  url: "https://uk.arccosgolf.com/blogs/community/arccos-golf-releases-largest-ever-annual-driving-distance-report-leveraging-data-from-25-million-rounds-to-deliver-eight-year-trend-analysis-across-age-gender-and-skill-level",
  publicationDate: "2026-05-06",
  dataPeriod: "2025 play",
  description: "Report covers more than 5 million rounds and nearly 10 million driver tee shots, with age/gender/handicap cohorts. No values are included in this corpus because detailed anchors have not been extracted and independently spot-checked.",
});
