// @ts-check
// The license policy, docs/decisions/0001-license-policy.md. Its lists live in license-policy.json.
import fs from 'node:fs';
import { SpdxSyntaxError, failingLicenses, formatSpdx, parseSpdx } from './spdx.mjs';

/** @typedef {import('./spdx.mjs').LicenseNode} LicenseNode */
/**
 * "shipped": reachable through `dependencies` of a workspace package. "dev": everything else.
 * @typedef {'shipped' | 'dev'} Scope
 */
/**
 * A license confirmed by hand. It replaces the package's own metadata and is then judged normally.
 * @typedef {{ name: string, version?: string, license: string, reason: string }} PolicyException
 */
/**
 * @typedef {object} Policy
 * @property {{ shipped: string[], devOnly: string[] }} allowed devOnly: also allowed for dev-only packages.
 * @property {{ license: string, packages: string[], devOnly?: boolean, reason: string }[]} allowedForPackages
 * @property {{ pattern: string, label: string }[]} blockedLicenses Case-insensitive regular expressions.
 * @property {{ name: string, reason: string }[]} blockedPackages
 * @property {PolicyException[]} exceptions
 */
/** @typedef {{ ok: boolean, license: string, problems: string[], exception: PolicyException | null }} Verdict */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Whether a package name matches a glob in which "*" stands for any characters except "/".
 *
 * @param {string} glob For example "@tiptap-pro/*".
 * @param {string} name
 */
export function matchesName(glob, name) {
  const escaped = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[^/]*')}$`).test(name);
}

/**
 * Checks the shape of parsed license-policy.json.
 *
 * @param {unknown} data
 * @returns {Policy}
 */
export function checkPolicy(data) {
  const root = isRecord(data) ? data : {};
  const allowed = isRecord(root.allowed) ? root.allowed : {};
  const problems = ['shipped', 'devOnly']
    .filter((key) => {
      const ids = allowed[key];
      return !Array.isArray(ids) || !ids.every(isText);
    })
    .map((key) => `allowed.${key} must be a list of license identifiers`);
  /** @type {Record<string, string[]>} */
  const required = {
    allowedForPackages: ['license', 'reason'],
    blockedLicenses: ['pattern', 'label'],
    blockedPackages: ['name', 'reason'],
    exceptions: ['name', 'license', 'reason'],
  };
  for (const [key, fields] of Object.entries(required)) {
    const entries = root[key] ?? [];
    if (!Array.isArray(entries)) problems.push(`${key} must be a list`);
    else {
      entries.forEach((entry, i) => {
        const where = `${key}[${i}]`;
        const record = isRecord(entry) ? entry : {};
        for (const field of fields)
          if (!isText(record[field])) problems.push(`${where}.${field} is required`);
        const packages = record.packages;
        if (key === 'allowedForPackages' && !(Array.isArray(packages) && packages.every(isText))) {
          problems.push(`${where}.packages must be a list of package names`);
        }
        if (key === 'blockedLicenses' && isText(record.pattern)) {
          try {
            new RegExp(record.pattern, 'i');
          } catch {
            problems.push(`${where}.pattern is not a valid regular expression`);
          }
        }
        if (key === 'exceptions' && isText(record.license)) {
          try {
            parseSpdx(record.license);
          } catch {
            problems.push(`${where}.license is not a valid SPDX expression`);
          }
        }
        if (key === 'exceptions' && record.version !== undefined && !isText(record.version)) {
          problems.push(`${where}.version must be an exact version`);
        }
      });
    }
  }
  if (problems.length > 0) throw new Error(`license-policy.json: ${problems.join('; ')}`);
  const defaults = {
    allowedForPackages: [],
    blockedLicenses: [],
    blockedPackages: [],
    exceptions: [],
  };
  return /** @type {Policy} */ (/** @type {unknown} */ ({ ...defaults, ...root })); // shape checked above
}

/** @param {string} file @returns {Policy} */
export const loadPolicy = (file) => checkPolicy(JSON.parse(fs.readFileSync(file, 'utf8')));

/**
 * The declared license as one expression, or null. Also reads the legacy `{ type }` object and
 * `licenses` array; several legacy entries mean a choice, so they are joined with OR.
 *
 * @param {{ license?: unknown, licenses?: unknown }} manifest
 * @returns {string | null}
 */
export function declaredLicense(manifest) {
  /** @param {unknown} value @returns {string} */
  const typeOf = (value) => {
    if (typeof value === 'string') return value.trim();
    return isRecord(value) && typeof value.type === 'string' ? value.type.trim() : '';
  };
  const single = typeOf(manifest.license);
  if (single !== '') return single;
  const legacy = [manifest.license, manifest.licenses].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  const types = legacy.map(typeOf).filter((type) => type !== '');
  if (types.length <= 1) return types[0] ?? null;
  return types.map((type) => (/\s/.test(type) ? `(${type})` : type)).join(' OR ');
}

/**
 * Judges one license of an expression for one package.
 *
 * @param {LicenseNode} license
 * @param {string} name Package name.
 * @param {Scope} scope
 * @param {Policy} policy
 * @returns {string | null} Why the license is not allowed, or null when it is.
 */
export function judgeLicense(license, name, scope, policy) {
  const text = formatSpdx(license);
  const blocked = policy.blockedLicenses.find(({ pattern }) =>
    [license.id, license.exception].some((id) => id !== null && new RegExp(pattern, 'i').test(id)),
  );
  if (blocked) return `${text} is blocked (${blocked.label})`;
  const same = (/** @type {string} */ id) => id.toLowerCase() === license.id.toLowerCase();
  if (policy.allowed.shipped.some(same)) return null;
  if (policy.allowed.devOnly.some(same)) {
    return scope === 'dev' ? null : `${text} is allowed only in dev and test tools`;
  }
  const rules = policy.allowedForPackages.filter((rule) => same(rule.license));
  const rule = rules.find(({ packages }) => packages.some((glob) => matchesName(glob, name)));
  if (rule)
    return scope === 'dev' || !rule.devOnly
      ? null
      : `${text} is allowed for ${name} only in dev and test tools`;
  if (rules[0]) return `${text} is allowed only for ${rules[0].packages.join(', ')}`;
  return `${text} is not on the allowed list`;
}

/**
 * Judges a package: blocked names first, then its declared license (or its exception's).
 *
 * @param {{ name: string, version: string, license?: unknown, licenses?: unknown }} pkg
 * @param {Scope} scope
 * @param {Policy} policy
 * @returns {Verdict}
 */
export function evaluatePackage(pkg, scope, policy) {
  const exception =
    policy.exceptions.find(
      ({ name, version }) =>
        name === pkg.name && (version === undefined || version === pkg.version),
    ) ?? null;
  const declared = exception ? exception.license : declaredLicense(pkg);
  /** @param {string} license @param {string[]} problems @returns {Verdict} */
  const verdict = (license, problems) => ({
    ok: problems.length === 0,
    license,
    problems,
    exception,
  });

  const blocked = policy.blockedPackages.find((rule) => matchesName(rule.name, pkg.name));
  if (blocked) return verdict(declared ?? '(none)', [`the package is blocked: ${blocked.reason}`]);
  if (declared === null) return verdict('(none)', ['no license is declared']);
  if (/^UNLICENSED$/i.test(declared))
    return verdict(declared, ['UNLICENSED: no license is granted']);
  if (/^SEE LICEN[CS]E IN\b/i.test(declared))
    return verdict(declared, [`custom license terms ("${declared}")`]);
  try {
    const tree = parseSpdx(declared);
    const reasons = failingLicenses(
      tree,
      (license) => judgeLicense(license, pkg.name, scope, policy) === null,
    ).map((license) => judgeLicense(license, pkg.name, scope, policy) ?? '');
    return verdict(formatSpdx(tree), [...new Set(reasons)]);
  } catch (error) {
    if (!(error instanceof SpdxSyntaxError)) throw error;
    return verdict(declared, [`"${declared}" is not a valid SPDX expression (${error.reason})`]);
  }
}
