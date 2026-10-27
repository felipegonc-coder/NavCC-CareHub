#!/usr/bin/env node
// License check: docs/decisions 0001, 0009 and 0011, lists in license-policy.json. See --help.
import { main } from './license-check/cli.mjs';

process.exitCode = main();
