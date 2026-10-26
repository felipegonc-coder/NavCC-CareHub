#!/usr/bin/env node
// License check: docs/decisions/0001-license-policy.md, lists in license-policy.json. See --help.
import { main } from './license-check/cli.mjs';

process.exitCode = main();
