export const DEFAULT_COLD_STARTUP_BUDGET_MS = 5000;
export const DEFAULT_FIXTURE_LOAD_BUDGET_MS = 6000;

const within = (duration, budget, maximumBudget) => Number.isFinite(duration) && duration >= 0
  && Number.isFinite(budget) && budget > 0 && budget <= maximumBudget && duration <= budget;

export function readinessBudgetValidation({ coldStartupMs, fixtureLoadMs, startupBudgetMs, fixtureBudgetMs }) {
  const coldStartupWithinBudget = within(coldStartupMs, startupBudgetMs, DEFAULT_COLD_STARTUP_BUDGET_MS);
  const fixtureLoadWithinBudget = within(fixtureLoadMs, fixtureBudgetMs, DEFAULT_FIXTURE_LOAD_BUDGET_MS);
  return { coldStartupWithinBudget, fixtureLoadWithinBudget, passed: coldStartupWithinBudget && fixtureLoadWithinBudget };
}

export function rendererBudgetValidation({ workMs, p95Ms, workBudgetMs, frameBudgetMs, assertFrame }) {
  const rendererWorkWithinBudget = within(workMs, workBudgetMs, 8);
  const frameWithinBudget = assertFrame ? within(p95Ms, frameBudgetMs, 33) : null;
  return { rendererWorkWithinBudget, frameWithinBudget, passed: rendererWorkWithinBudget && (!assertFrame || frameWithinBudget) };
}
