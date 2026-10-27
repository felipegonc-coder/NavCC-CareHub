#!/usr/bin/env node
// npm run lint: ESLint over the repository. Like `eslint . --max-warnings=0`, it fails on any error
// or warning, except carehub/no-one-off-styles warnings, which only the lane folders get (see
// eslint.config.js). Those are listed, and shown next to the line in the pull request, but pass
// until 2026-10-29. After that the rule is an error everywhere and `lint` can go back to
// `eslint . --max-warnings=0`.
import path from 'node:path';
import process from 'node:process';
import { ESLint } from 'eslint';

const PASSING_WARNING = 'carehub/no-one-off-styles';

const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);
const formatter = await eslint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) console.log(output);

let failing = 0;
let passing = 0;
for (const result of results) {
  for (const message of result.messages) {
    if (message.severity !== 1 || message.ruleId !== PASSING_WARNING) {
      failing += 1;
      continue;
    }
    passing += 1;
    if (process.env.GITHUB_ACTIONS === 'true') {
      const file = path.relative(process.cwd(), result.filePath);
      const text = message.message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
      console.log(`::warning file=${file},line=${message.line},col=${message.column}::${text}`);
    }
  }
}
if (passing > 0) {
  console.log(`${passing} one-off style warning(s) in lane folders. They fail from 2026-10-29.`);
}
if (failing > 0) {
  console.error(`ESLint found ${failing} problem(s); errors and warnings both fail.`);
  process.exitCode = 1;
}
