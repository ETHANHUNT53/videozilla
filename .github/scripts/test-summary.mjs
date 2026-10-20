// CI "Test summary" step: the test counts and, for each failed test, its name and first error line, as annotations
// and on the run page. Step logs need a GitHub sign-in; annotations and the summary don't, so a failure can be named
// without the raw log (F2.7 QA: a CI-only failure nobody could identify).
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

const report = JSON.parse(readFileSync(".cache/vitest.json", "utf8"));
const line = `${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped (${report.testResults.length} files)`;
console.log(`::notice title=Unit tests::${line}`);

/** Workflow commands end at a newline and treat `%`, `,` and `:` specially in properties. */
const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

const failed = report.testResults.flatMap((file) =>
  file.assertionResults
    .filter((t) => t.status === "failed")
    .map((t) => ({ file: path.relative(process.cwd(), file.name).replace(/\\/g, "/"), name: t.fullName, why: (t.failureMessages?.[0] ?? "").split("\n").slice(0, 3).join("\n").slice(0, 500) })),
);
// A file that failed to load has no test results, only a message.
for (const file of report.testResults.filter((f) => f.status === "failed" && !f.assertionResults.some((t) => t.status === "failed"))) {
  failed.push({ file: path.relative(process.cwd(), file.name).replace(/\\/g, "/"), name: "(the file failed to run)", why: (file.message ?? "").slice(0, 500) });
}
for (const t of failed.slice(0, 20)) console.log(`::error file=${escapeProperty(t.file)},title=${escapeProperty(`Failed: ${t.name}`.slice(0, 250))}::${escapeData(t.why)}`);

const list = failed.map((t) => `- ❌ \`${t.file}\` › ${t.name}`).join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Unit tests\n${line}\n${list}\n`);
