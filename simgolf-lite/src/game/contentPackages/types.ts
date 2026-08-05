import type { Course, Difficulty, LandTheme, ScenarioConstraints } from "../models/types";
import type { GoalDefinition } from "../models/objectives";
import type { BiomeCompatibilityMetadata } from "../models/biomes";
import type { HoleTemplateV1 } from "../holeTemplates/types";

export type CoursePackageKind = "course" | "challenge";
export type ContentPackageKind = CoursePackageKind | "hole-template";
export type PackageCompatibility = "compatible" | "migratable" | "unsupported" | "corrupt";

export interface CoursePackageManifestV1 {
  format: "coursecraft-package";
  version: 1;
  kind: CoursePackageKind;
  contentId: string;
  revision: number;
  title: string;
  description: string;
  author: {
    id: string;
    displayName: string;
  };
  createdAt: string;
  updatedAt: string;
  requiredGameVersion: string;
  requiredSaveSchema: number;
  theme: LandTheme;
  /** Added in save schema 23; absent packages are migrated on import. */
  biomeCompatibility?: BiomeCompatibilityMetadata;
  checksum: string;
  preview?: {
    mime: "image/png" | "image/jpeg";
    dataUrl: string;
  };
}

export interface ChallengePayloadV1 {
  difficulty: Difficulty;
  startingCash?: number;
  goals: GoalDefinition[];
  /** Optional IDs selected from the built-in, safe longevity/template catalog. */
  goalTemplateIds?: string[];
  constraints?: ScenarioConstraints;
  allowedEventIds: string[];
  medalTargets?: {
    silver?: number;
    gold?: number;
  };
}

export interface CoursePackagePayloadV1 {
  course: Course;
  challenge?: ChallengePayloadV1;
}

export interface CoursePackageV1 {
  manifest: CoursePackageManifestV1;
  payload: CoursePackagePayloadV1;
}

/** A portable, revisioned package for a single authored hole. It deliberately
 * carries no estate, economy, placement, or save-state references. */
export interface HoleTemplatePackageManifestV1 {
  format: "coursecraft-hole-template-package";
  version: 1;
  kind: "hole-template";
  contentId: string;
  revision: number;
  title: string;
  description: string;
  author: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  requiredGameVersion: string;
  /** Capture context only; placement never reads this value. */
  theme: LandTheme;
  checksum: string;
}

export interface HoleTemplatePackageV1 {
  manifest: HoleTemplatePackageManifestV1;
  payload: { template: HoleTemplateV1 };
}

export type ContentPackageV1 = CoursePackageV1 | HoleTemplatePackageV1;

export type PackageValidationResult =
  | { status: "compatible"; value: ContentPackageV1; warnings: string[] }
  | { status: "migratable"; value: CoursePackageV1; warnings: string[] }
  | { status: "unsupported"; errors: string[] }
  | { status: "corrupt"; errors: string[] };

export interface ContentLibraryEntry {
  contentId: string;
  revision: number;
  kind: ContentPackageKind;
  title: string;
  author: string;
  theme: LandTheme;
  updatedAt: string;
  createdAt?: string;
  authorId?: string;
  source: "local" | "manual" | "workshop" | "cached";
  state: "ready" | "subscribed" | "downloading" | "installed" | "cached" | "update-available" | "incompatible" | "corrupt" | "quarantined";
  quarantined?: boolean;
  quarantineReason?: "corrupt" | "incompatible";
  packageKey: string;
  preview?: CoursePackageManifestV1["preview"];
  publishedId?: string;
}

export interface WorkshopPublishResult {
  publishedId: string;
  needsLegalAgreement: boolean;
  /** Provider-owned operation metadata; never persisted in package contents. */
  operationId?: string;
  progress?: number;
  /** A provider may explicitly report that the current account is not owner. */
  ownershipVerified?: boolean;
  ownership?: "owner" | "not-owner" | "unknown";
  legalAgreementUrl?: string | null;
}
