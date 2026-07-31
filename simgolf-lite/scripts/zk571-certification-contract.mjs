import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export const ZK571_PERFORMANCE_CONTRACT = Object.freeze({
  fixture: "perfFixture",
  workBudgetMilliseconds: 8,
  startupBudgetMilliseconds: 5_000,
  frameBudgetMilliseconds: 33,
  measureSeconds: 20,
  warmupSeconds: 8,
  frameAssertion: false,
});

const sameOrWithin = (root, candidate) => {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !parse(rel).root);
};

function physicalPath(candidate) {
  const unresolved = [];
  let existing = candidate;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    unresolved.unshift(basename(existing));
    existing = parent;
  }
  const physical = existsSync(existing) ? realpathSync(existing) : existing;
  return resolve(physical, ...unresolved);
}

export function resolveZk571ArtifactDirectory(
  value,
  {
    appRoot,
    repoRoot = resolve(appRoot, ".."),
    homeDirectory = homedir(),
    temporaryRoot = tmpdir(),
  },
) {
  if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
    throw new Error("ZK571_ARTIFACT_DIRECTORY must be a non-empty path when provided.");
  }
  if (typeof value === "string") {
    if (value.includes("\0")) throw new Error("ZK571_ARTIFACT_DIRECTORY contains a NUL byte.");
    if (value.split(/[\\/]+/).some((segment) => segment === "." || segment === "..")) {
      throw new Error("ZK571_ARTIFACT_DIRECTORY cannot contain '.' or '..' path segments.");
    }
  }

  const logicalCanonical = resolve(appRoot, "artifacts/zk-571/v1");
  const logicalCandidate = value === undefined
    ? logicalCanonical
    : resolve(appRoot, value);
  if (existsSync(logicalCandidate) && lstatSync(logicalCandidate).isSymbolicLink()) {
    throw new Error("ZK571_ARTIFACT_DIRECTORY cannot be a symbolic-link leaf.");
  }
  const candidate = physicalPath(logicalCandidate);
  const canonical = physicalPath(logicalCanonical);
  const resolvedAppRoot = physicalPath(resolve(appRoot));
  const resolvedRepoRoot = physicalPath(resolve(repoRoot));
  const resolvedHome = physicalPath(resolve(homeDirectory));

  const broadRoots = [
    parse(candidate).root,
    physicalPath(resolve("/tmp")),
    physicalPath(resolve("/private/tmp")),
    physicalPath(resolve("/var")),
    physicalPath(resolve("/private/var")),
    resolvedHome,
    resolvedRepoRoot,
    resolvedAppRoot,
  ];
  if (broadRoots.includes(candidate)
    || sameOrWithin(candidate, resolvedAppRoot)
    || sameOrWithin(candidate, resolvedRepoRoot)
    || sameOrWithin(candidate, resolvedHome)) {
    throw new Error(`Refusing broad or ancestor ZK-571 artifact path: ${candidate}`);
  }

  if (candidate === canonical) return candidate;
  if (!/^zk571-[a-z0-9][a-z0-9._-]{2,}$/i.test(basename(candidate))) {
    throw new Error("Override artifact paths must use a dedicated 'zk571-*' leaf.");
  }

  const artifactNamespace = physicalPath(resolve(appRoot, "artifacts/zk-571"));
  const allowedRoots = [
    artifactNamespace,
    physicalPath(resolve("/tmp")),
    physicalPath(resolve("/private/tmp")),
    physicalPath(resolve(temporaryRoot)),
  ];
  if (!allowedRoots.some((root) => candidate !== root && sameOrWithin(root, candidate))) {
    throw new Error("Override artifact path must be inside the ZK-571 artifact namespace or a temporary root.");
  }
  if (existsSync(candidate) && !lstatSync(candidate).isDirectory()) {
    throw new Error("ZK571_ARTIFACT_DIRECTORY must be a directory path.");
  }
  return candidate;
}

export function prepareZk571ArtifactDirectory(value, context) {
  const directory = resolveZk571ArtifactDirectory(value, context);
  const stale = `${directory}.stale-${process.pid}-${Date.now()}`;
  if (existsSync(stale)) {
    throw new Error(`Refusing to replace existing stale preparation path: ${stale}`);
  }
  let moved = false;
  try {
    if (existsSync(directory)) {
      renameSync(directory, stale);
      moved = true;
    }
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    if (moved && !existsSync(directory) && existsSync(stale)) {
      renameSync(stale, directory);
    }
    throw error;
  }
  if (moved) rmSync(stale, { recursive: true, force: true });
  return directory;
}

export function zk571ScreenshotDirectory(artifactDirectory) {
  return resolve(artifactDirectory, "screenshots");
}

export function zk571BrowserEnvironment(artifactDirectory) {
  return {
    CI: "1",
    ZK567_BASE_URL: "",
    ZK571_ARTIFACT_DIRECTORY: artifactDirectory,
  };
}

export function zk571PwaEnvironment() {
  return {
    set: {
      COURSECRAFT_PWA_BASE: "/",
      COURSECRAFT_PWA_PORT: "4175",
    },
    unset: ["COURSECRAFT_PWA_URL"],
  };
}

export function applyEnvironmentContract(inherited, set = {}, unset = []) {
  const result = { ...inherited, ...set };
  for (const name of unset) delete result[name];
  return result;
}

export function zk571PerformanceArtifactPath(artifactDirectory, theme) {
  return resolve(artifactDirectory, `performance-${theme}.json`);
}

export function zk571PerformanceEnvironment(artifactDirectory, theme) {
  return {
    PERF_THEME: theme,
    PERF_WORK_BUDGET_MS: String(ZK571_PERFORMANCE_CONTRACT.workBudgetMilliseconds),
    PERF_STARTUP_BUDGET_MS: String(ZK571_PERFORMANCE_CONTRACT.startupBudgetMilliseconds),
    PERF_BUDGET_MS: String(ZK571_PERFORMANCE_CONTRACT.frameBudgetMilliseconds),
    PERF_MEASURE_S: String(ZK571_PERFORMANCE_CONTRACT.measureSeconds),
    PERF_FIXTURE: ZK571_PERFORMANCE_CONTRACT.fixture,
    PERF_ASSERT_FRAME: "0",
    PERF_OUTPUT_PATH: zk571PerformanceArtifactPath(artifactDirectory, theme),
  };
}

const finiteNonnegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function validateZk571PerformanceEvidence(value, expectedTheme) {
  const errors = [];
  if (!value || typeof value !== "object") {
    return { ok: false, errors: ["evidence must be an object"] };
  }
  if (value.version !== 1) errors.push("version must be 1");
  if (value.theme !== expectedTheme) errors.push(`theme must be ${expectedTheme}`);
  if (value.fixture !== ZK571_PERFORMANCE_CONTRACT.fixture) {
    errors.push(`fixture must be ${ZK571_PERFORMANCE_CONTRACT.fixture}`);
  }
  if (!finiteNonnegative(value.coldStartupMs)) errors.push("coldStartupMs must be finite and nonnegative");
  if (!finiteNonnegative(value.fixtureLoadMs)) errors.push("fixtureLoadMs must be finite and nonnegative");
  const renderer = value.renderer;
  if (!renderer || typeof renderer !== "object") {
    errors.push("renderer must be an object");
  } else {
    for (const field of ["workMs", "fps", "p95Ms"]) {
      if (!finiteNonnegative(renderer[field])) errors.push(`renderer.${field} must be finite and nonnegative`);
    }
    if (!renderer.sections || typeof renderer.sections !== "object" || Array.isArray(renderer.sections)) {
      errors.push("renderer.sections must be an object");
    } else if (!Object.values(renderer.sections).every(finiteNonnegative)) {
      errors.push("renderer.sections values must be finite and nonnegative");
    }
  }
  const effective = value.effective;
  const expectedEffective = {
    theme: expectedTheme,
    fixture: ZK571_PERFORMANCE_CONTRACT.fixture,
    measureSeconds: ZK571_PERFORMANCE_CONTRACT.measureSeconds,
    warmupSeconds: ZK571_PERFORMANCE_CONTRACT.warmupSeconds,
    frameAssertion: ZK571_PERFORMANCE_CONTRACT.frameAssertion,
    budgets: {
      rendererWorkMilliseconds: ZK571_PERFORMANCE_CONTRACT.workBudgetMilliseconds,
      coldStartupMilliseconds: ZK571_PERFORMANCE_CONTRACT.startupBudgetMilliseconds,
      frameMilliseconds: ZK571_PERFORMANCE_CONTRACT.frameBudgetMilliseconds,
    },
  };
  if (JSON.stringify(effective) !== JSON.stringify(expectedEffective)) {
    errors.push("effective workload/budgets do not match the pinned ZK-571 contract");
  }
  const expectedGateValidation = {
    coldStartupWithinBudget: finiteNonnegative(value.coldStartupMs)
      && value.coldStartupMs <= ZK571_PERFORMANCE_CONTRACT.startupBudgetMilliseconds,
    rendererWorkWithinBudget: renderer && finiteNonnegative(renderer.workMs)
      ? renderer.workMs <= ZK571_PERFORMANCE_CONTRACT.workBudgetMilliseconds
      : false,
    frameWithinBudget: null,
  };
  expectedGateValidation.passed =
    expectedGateValidation.coldStartupWithinBudget
    && expectedGateValidation.rendererWorkWithinBudget;
  if (JSON.stringify(value.gateValidation) !== JSON.stringify(expectedGateValidation)) {
    errors.push("gateValidation must exactly reconcile the observed values and pinned budgets");
  }
  if (finiteNonnegative(value.coldStartupMs)
    && value.coldStartupMs > ZK571_PERFORMANCE_CONTRACT.startupBudgetMilliseconds) {
    errors.push("coldStartupMs exceeds the pinned startup budget");
  }
  if (renderer && finiteNonnegative(renderer.workMs)
    && renderer.workMs > ZK571_PERFORMANCE_CONTRACT.workBudgetMilliseconds) {
    errors.push("renderer.workMs exceeds the pinned work budget");
  }
  return { ok: errors.length === 0, errors };
}
