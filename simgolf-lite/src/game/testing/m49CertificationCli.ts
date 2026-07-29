/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { runM49Certification } from "./m49Certification";

const report = runM49Certification();
const output = new URL("../artifacts/m49/certification.json", import.meta.url);
mkdirSync(new URL("../artifacts/m49", import.meta.url), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
