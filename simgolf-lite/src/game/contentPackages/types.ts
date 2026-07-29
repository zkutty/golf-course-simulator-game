import type { Course, Difficulty, LandTheme, ScenarioConstraints } from "../models/types";
import type { GoalDefinition } from "../models/objectives";

export type CoursePackageKind = "course" | "challenge";
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

export type PackageValidationResult =
  | { status: "compatible"; value: CoursePackageV1; warnings: string[] }
  | { status: "migratable"; value: CoursePackageV1; warnings: string[] }
  | { status: "unsupported"; errors: string[] }
  | { status: "corrupt"; errors: string[] };

export interface ContentLibraryEntry {
  contentId: string;
  revision: number;
  kind: CoursePackageKind;
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
