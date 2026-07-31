/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  M53_CERTIFICATION_ID,
  M53_UNRESOLVED_RISKS,
  runM53Certification,
} from "./m53Certification";

const report = runM53Certification();
const directory = process.env.ZK571_ARTIFACT_DIRECTORY
  ? resolve(process.env.ZK571_ARTIFACT_DIRECTORY)
  : new URL("../artifacts/zk-571/v1/", import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(
  typeof directory === "string"
    ? resolve(directory, "core-certification.json")
    : new URL("core-certification.json", directory),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
  typeof directory === "string"
    ? resolve(directory, "risk-register.json")
    : new URL("risk-register.json", directory),
  `${JSON.stringify({
    version: 1,
    certificationId: M53_CERTIFICATION_ID,
    risks: M53_UNRESOLVED_RISKS,
  }, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
