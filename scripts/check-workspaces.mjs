#!/usr/bin/env node
// Workspace check (issue #75): every @carehub/* package must come from this repository. npm links
// a @carehub/* dependency to a workspace only when a workspace has that exact name and a version
// in range. Otherwise it looks the name up on the public npm registry, where whoever owns the
// scope can publish it.
//
// Fails when
// - a @carehub/* dependency in the root or a workspace package.json names no workspace, or has a
//   range other than "*", or a dependency is an npm: alias of a @carehub/* name, or
// - a @carehub/* entry in package-lock.json isn't a link into a workspace folder.
//
// It uses only Node's built-in modules, so CI runs it before npm ci, and the repo bot runs it
// before it pushes a new lockfile.
//
//   node scripts/check-workspaces.mjs [repository folder, default: the current one]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SCOPE = '@carehub/';
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
// "node_modules/@carehub/<name>", or nested, like "apps/web/node_modules/@carehub/<name>".
const LOCK_KEY = /(?:^|\/)node_modules\/(@carehub\/[^/]+)$/;
// The workspace patterns this check understands: "dir" and "dir/*", without other glob characters.
const PATTERN = /^[\w@.-]+(?:\/[\w@.-]+)*(?:\/\*)?$/;

/**
 * @typedef {Record<string, unknown>} Json
 * @typedef {{ folder: string, manifest: Json }} Workspace
 * @typedef {{ errors: string[], warnings: string[], dependencies: number, lockEntries: number }} Result
 */

/**
 * @param {unknown} value
 * @returns {value is Json}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} root
 * @param {string} file relative to root
 * @returns {Json}
 */
function readJson(root, file) {
  let value;
  try {
    value = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    throw new Error(`Can't read ${file}: ${message(error)}`);
  }
  if (!isObject(value)) throw new Error(`${file} isn't a JSON object.`);
  return value;
}

/**
 * The root package.json's workspace patterns, without "./" or a trailing "/". Reports the ones
 * this check doesn't understand.
 * @param {Json} manifest
 * @param {string[]} errors
 */
function workspacePatterns(manifest, errors) {
  const declared = isObject(manifest.workspaces)
    ? manifest.workspaces.packages
    : manifest.workspaces;
  /** @type {string[]} */
  const patterns = [];
  for (const raw of Array.isArray(declared) ? declared : []) {
    const pattern = String(raw).replace(/^\.\//, '').replace(/\/$/, '');
    if (PATTERN.test(pattern) && !pattern.split('/').includes('..')) {
      patterns.push(pattern);
    } else {
      errors.push(
        `package.json: this check only understands workspace patterns like "apps/*" or ` +
          `"apps/web", not ${JSON.stringify(raw)}. Update scripts/check-workspaces.mjs.`,
      );
    }
  }
  return patterns;
}

/**
 * The folders (relative, with "/") that the patterns match, like npm: those with a package.json,
 * without hidden ones.
 * @param {string} root
 * @param {string[]} patterns
 */
function workspaceFolders(root, patterns) {
  /** @type {Set<string>} */
  const folders = new Set();
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      folders.add(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    if (!existsSync(path.join(root, parent))) continue;
    for (const entry of readdirSync(path.join(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        folders.add(`${parent}/${entry.name}`);
    }
  }
  return [...folders]
    .filter((folder) => existsSync(path.join(root, folder, 'package.json')))
    .sort();
}

/**
 * Whether a folder (relative, with "/") is one that a workspace pattern matches.
 * @param {string} folder
 * @param {string[]} patterns
 */
function matchesPattern(folder, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('/*')
      ? path.posix.dirname(folder) === pattern.slice(0, -2)
      : folder === pattern,
  );
}

/**
 * Checks the repository in root.
 * @param {string} root
 * @returns {Result}
 */
export function checkWorkspaces(root) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const rootManifest = readJson(root, 'package.json');
  const patterns = workspacePatterns(rootManifest, errors);

  /** @type {Workspace[]} */
  const workspaces = workspaceFolders(root, patterns).map((folder) => ({
    folder,
    manifest: readJson(root, `${folder}/package.json`),
  }));
  /** @type {Map<string, Workspace>} */
  const byName = new Map();
  for (const workspace of workspaces) {
    const name = workspace.manifest.name;
    if (typeof name !== 'string') continue;
    const other = byName.get(name);
    if (other) {
      errors.push(
        `${other.folder}/package.json and ${workspace.folder}/package.json are both named ${name}.`,
      );
    } else {
      byName.set(name, workspace);
    }
  }

  let dependencies = 0;
  const manifests = [
    { file: 'package.json', manifest: rootManifest },
    ...workspaces.map((w) => ({ file: `${w.folder}/package.json`, manifest: w.manifest })),
  ];
  for (const { file, manifest } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (!isObject(deps)) continue;
      for (const [name, spec] of Object.entries(deps)) {
        const where = `${file}: ${field}["${name}"]`;
        if (typeof spec === 'string' && spec.startsWith(`npm:${SCOPE}`)) {
          dependencies += 1;
          errors.push(
            `${where} is "${spec}", an npm: alias, which always comes from the registry. ` +
              `Depend on the workspace by its own name.`,
          );
        } else if (name.startsWith(SCOPE)) {
          dependencies += 1;
          if (!byName.has(name)) {
            errors.push(
              `${where}: no workspace has that name, so npm would look it up on the public ` +
                `registry. Fix the name, or wait until that workspace is on main.`,
            );
          } else if (spec !== '*') {
            errors.push(
              `${where} is ${JSON.stringify(spec)}. Use "*": npm links the workspace only when ` +
                `its version is in range, and otherwise looks on the registry.`,
            );
          }
        }
      }
    }
  }

  let lockEntries = 0;
  if (!existsSync(path.join(root, 'package-lock.json'))) {
    errors.push('package-lock.json is missing.');
    return { errors, warnings, dependencies, lockEntries };
  }
  const lock = readJson(root, 'package-lock.json');
  if (!isObject(lock.packages)) {
    errors.push('package-lock.json has no "packages" section (npm 7 or later writes one).');
    return { errors, warnings, dependencies, lockEntries };
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = LOCK_KEY.exec(key)?.[1];
    if (!name) continue;
    lockEntries += 1;
    const resolved = isObject(entry) ? entry.resolved : undefined;
    if (!isObject(entry) || entry.link !== true) {
      const from = typeof resolved === 'string' ? resolved : 'the registry';
      errors.push(
        `package-lock.json: "${key}" is installed from ${from}, not linked to a workspace.`,
      );
      continue;
    }
    const target = typeof resolved === 'string' ? path.posix.normalize(resolved) : '';
    if (!matchesPattern(target, patterns)) {
      errors.push(
        `package-lock.json: "${key}" links to ${JSON.stringify(resolved)}, which isn't a ` +
          `workspace folder (${patterns.join(', ')}).`,
      );
    } else if (byName.get(name)?.folder !== target) {
      warnings.push(
        `package-lock.json: "${key}" links to ${target}, which isn't the workspace named ${name}. ` +
          `The lockfile is out of date; npm install updates it, and so does the repo bot on main.`,
      );
    }
  }
  return { errors, warnings, dependencies, lockEntries };
}

/**
 * Runs the check and prints the result; returns the exit code.
 * @param {string[]} args
 */
export function main(args) {
  let result;
  try {
    result = checkWorkspaces(path.resolve(args[0] ?? '.'));
  } catch (error) {
    console.error(`Workspace check: ${message(error)}`);
    return 1;
  }
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  if (result.errors.length > 0) {
    console.error('Workspace check failed. npm could install these @carehub/* packages from the');
    console.error('public registry instead of this repository (issue #75):');
    for (const error of result.errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(
    `Workspace check passed: ${result.dependencies} @carehub/* dependencies name a workspace, and ` +
      `${result.lockEntries} @carehub/* entries in package-lock.json link to one.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
