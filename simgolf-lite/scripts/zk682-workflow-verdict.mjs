import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PHYSICAL_BLOCKERS = new Set(["midrange-physical-p95", "low-end-physical-p95"]);
const fullCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

export function verifyZk682WorkflowReport(report, expectedCommit) {
  const errors = [];
  if (!fullCommit(expectedCommit)) errors.push("expected commit must be a full 40-character SHA");
  if (!report || typeof report !== "object" || Array.isArray(report)) errors.push("certification report must be an object");
  if (errors.length) return { valid: false, errors };
  if (report.candidateCommit !== expectedCommit) errors.push("certification report candidate does not match the dispatched SHA");
  if (report.machinePassed !== true) errors.push("all machine criteria must pass");
  if (!new Set(["GO", "HOLD"]).has(report.decision)) errors.push("decision must be GO or HOLD");
  if (!Array.isArray(report.blockers)) errors.push("blockers must be an array");
  else {
    const blockerIds = report.blockers.map((blocker) => blocker?.criterionId);
    if (blockerIds.some((id) => !PHYSICAL_BLOCKERS.has(id))) errors.push("HOLD blockers must be physical-device criteria only");
    if (new Set(blockerIds).size !== blockerIds.length) errors.push("HOLD blockers must be unique");
    if (report.decision === "GO" && blockerIds.length !== 0) errors.push("GO cannot retain blockers");
    if (report.decision === "HOLD" && blockerIds.length === 0) errors.push("HOLD requires at least one physical-device blocker");
  }
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const reportPath = valueFor("--report");
  const expectedCommit = valueFor("--expected-commit") ?? process.env.ZK682_EXPECTED_COMMIT;
  if (!reportPath || args.some((arg) => arg.startsWith("--") && !["--report", "--expected-commit"].includes(arg))) {
    throw new Error("Usage: node scripts/zk682-workflow-verdict.mjs --report <certification-report.json> --expected-commit <full-sha>");
  }
  const report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
  const result = verifyZk682WorkflowReport(report, expectedCommit);
  if (!result.valid) throw new Error(`ZK-682 hosted certification failed:\n${result.errors.join("\n")}`);
  process.stdout.write(`${report.decision} machine criteria passed; blockers are physical-only\n`);
}
