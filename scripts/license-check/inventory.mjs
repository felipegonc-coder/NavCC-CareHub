// @ts-check
// Finds every installed third-party package and sorts it into "shipped" or "dev". Shipped means
// reachable through `dependencies` (with `optionalDependencies` and required peers) of any
// workspace package, resolved as Node does: from the dependent's folder up to the root.
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './policy.mjs';

/** @typedef {{ name: string, dir: string, manifest: Record<string, unknown> }} Workspace */
/**
 * @typedef {object} InstalledPackage
 * @property {string} name
 * @property {string} version
 * @property {string} dir Real path.
 * @property {string} relDir Where it was found, relative to the root.
 * @property {Record<string, unknown>} manifest
 * @property {import('./policy.mjs').Scope} scope
 */
/**
 * @typedef {object} Inventory
 * @property {string} root
 * @property {Workspace[]} workspaces The root package first.
 * @property {InstalledPackage[]} packages
 * @property {string[]} missing Required runtime dependencies that are not installed.
 */

/** @param {string} file @returns {Record<string, unknown> | null} */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return isRecord(data) ? data : null;
}
/** @param {string} dir @returns {string[]} */
const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
/** @param {unknown} value @returns {string[]} */
const keys = (value) => (isRecord(value) ? Object.keys(value) : []);
/** Locale-independent order, so output is stable. @param {string} a @param {string} b */
export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Workspace folders listed in the root package.json; "*" stands for any folder name ("apps/*").
 *
 * @param {string} root
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} Real paths.
 */
export function workspaceDirs(root, manifest) {
  const field = isRecord(manifest.workspaces) ? manifest.workspaces.packages : manifest.workspaces;
  const patterns = Array.isArray(field)
    ? field.filter((pattern) => typeof pattern === 'string')
    : [];
  /** @param {string[]} dirs @param {string} segment */
  const expand = (dirs, segment) => {
    if (!segment.includes('*')) return dirs.map((dir) => path.join(dir, segment));
    const escaped = segment.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`^${escaped.join('[^/]*')}$`);
    return dirs.flatMap((dir) =>
      entries(dir)
        .filter((name) => name !== 'node_modules' && !name.startsWith('.') && regex.test(name))
        .map((name) => path.join(dir, name)),
    );
  };
  const dirs = patterns.flatMap((pattern) =>
    pattern
      .split('/')
      .filter((s) => s !== '' && s !== '.')
      .reduce(expand, [root]),
  );
  const found = dirs
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => fs.realpathSync(dir));
  return [...new Set(found)].sort(compareText);
}

/**
 * Finds the folder of package `name` as Node would when importing it from `fromDir`.
 *
 * @param {string} fromDir Real path of the importing package.
 * @param {string} name
 * @param {string} root Real path of the repository root; the search does not go above it.
 * @returns {string | null} Real path.
 */
export function resolvePackage(fromDir, name, root) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (
      path.basename(dir) !== 'node_modules' &&
      fs.existsSync(path.join(candidate, 'package.json'))
    ) {
      return fs.realpathSync(candidate);
    }
    if (dir === root || !dir.startsWith(root + path.sep)) return null;
  }
}

/**
 * Runtime dependencies of a package with whether they may be missing: `optionalDependencies`
 * and peers may; `dependencies` may not. Optional peers are not followed.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {[name: string, optional: boolean][]}
 */
export function runtimeDependencies(manifest) {
  const meta = isRecord(manifest.peerDependenciesMeta) ? manifest.peerDependenciesMeta : {};
  /** @type {Map<string, boolean>} */
  const deps = new Map();
  for (const name of keys(manifest.peerDependencies)) {
    const peer = meta[name];
    if (!(isRecord(peer) && peer.optional === true)) deps.set(name, true);
  }
  for (const name of keys(manifest.dependencies)) deps.set(name, false);
  for (const name of keys(manifest.optionalDependencies)) deps.set(name, true);
  return [...deps];
}

/**
 * Scans node_modules of the root and every workspace and classifies each third-party package.
 *
 * @param {string} rootDir The folder with the root package.json.
 * @returns {Inventory}
 */
export function scanInstalled(rootDir) {
  const root = fs.realpathSync(rootDir);
  const rootManifest = readJson(path.join(root, 'package.json'));
  if (!rootManifest) throw new Error(`no package.json in ${root}`);
  if (!fs.existsSync(path.join(root, 'node_modules')))
    throw new Error(`no node_modules in ${root}: run npm install first`);
  /** @type {Workspace[]} */
  const workspaces = [root, ...workspaceDirs(root, rootManifest).filter((dir) => dir !== root)].map(
    (dir) => {
      const manifest = readJson(path.join(dir, 'package.json')) ?? {};
      const name =
        typeof manifest.name === 'string' ? manifest.name : path.relative(root, dir) || '(root)';
      return { name, dir, manifest };
    },
  );
  const own = new Set(workspaces.map((workspace) => workspace.dir));

  /** @type {Map<string, InstalledPackage>} */
  const installed = new Map();
  /** @param {string} location @returns {InstalledPackage | undefined} */
  const visit = (location) => {
    const dir = fs.existsSync(location) ? fs.realpathSync(location) : null; // null: a broken symlink
    const manifest =
      dir && !own.has(dir) && !installed.has(dir) ? readJson(path.join(dir, 'package.json')) : null;
    if (!dir || !manifest) return dir ? installed.get(dir) : undefined;
    const relDir = path.relative(root, location).split(path.sep).join('/');
    const name =
      typeof manifest.name === 'string' ? manifest.name : relDir.replace(/^.*node_modules\//, '');
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    /** @type {InstalledPackage} */
    const pkg = { name, version, dir, relDir, manifest, scope: 'dev' };
    installed.set(dir, pkg);
    visitAll(path.join(dir, 'node_modules'));
    return pkg;
  };
  /** @param {string} nodeModules */
  const visitAll = (nodeModules) => {
    for (const entry of entries(nodeModules).filter((name) => !name.startsWith('.'))) {
      const location = path.join(nodeModules, entry);
      if (!entry.startsWith('@')) visit(location);
      else
        for (const scoped of entries(location).filter((name) => !name.startsWith('.')))
          visit(path.join(location, scoped));
    }
  };
  for (const workspace of workspaces) visitAll(path.join(workspace.dir, 'node_modules'));

  /** @type {Set<string>} */
  const shipped = new Set();
  /** @type {Set<string>} */
  const missing = new Set();
  /** @type {(Workspace | InstalledPackage)[]} */
  const queue = [...workspaces];
  for (let item = queue.shift(); item; item = queue.shift()) {
    for (const [name, optional] of runtimeDependencies(item.manifest)) {
      const dir = resolvePackage(item.dir, name, root);
      if (!dir && !optional)
        missing.add(
          `${name} (required by ${'version' in item ? `${item.name}@${item.version}` : item.name})`,
        );
      if (!dir || own.has(dir) || shipped.has(dir)) continue;
      shipped.add(dir);
      const pkg = visit(dir);
      if (pkg) queue.push(pkg);
    }
  }
  for (const pkg of installed.values()) pkg.scope = shipped.has(pkg.dir) ? 'shipped' : 'dev';
  const packages = [...installed.values()].sort(
    (a, b) =>
      compareText(a.name, b.name) ||
      compareText(a.version, b.version) ||
      compareText(a.relDir, b.relDir),
  );
  return { root, workspaces, packages, missing: [...missing].sort(compareText) };
}
