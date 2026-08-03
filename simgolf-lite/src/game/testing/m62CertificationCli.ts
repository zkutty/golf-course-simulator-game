/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { runM62Certification } from "./m62Certification";

const report = await runM62Certification();
const outputDirectory = new URL("../artifacts/m62/", import.meta.url);
const output = new URL("certification-report.json", outputDirectory);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
