import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  licenseFiles,
  renderNotices,
  repositoryUrl,
} from '../../../scripts/license-check/notices.mjs';
import { makeTree, removeTrees } from '../support/tree.js';

afterEach(removeTrees);

describe('repositoryUrl', () => {
  it('turns the usual repository forms into a browsable URL', () => {
    const cases: [unknown, string | null][] = [
      ['octo/widgets', 'https://github.com/octo/widgets'],
      ['github:octo/widgets', 'https://github.com/octo/widgets'],
      ['gitlab:octo/widgets', 'https://gitlab.com/octo/widgets'],
      ['bitbucket:octo/widgets', 'https://bitbucket.org/octo/widgets'],
      ['git+https://github.com/octo/widgets.git', 'https://github.com/octo/widgets'],
      ['git://github.com/octo/widgets.git', 'https://github.com/octo/widgets'],
      ['git+ssh://git@github.com/octo/widgets.git', 'https://github.com/octo/widgets'],
      ['git@github.com:octo/widgets.git', 'https://github.com/octo/widgets'],
      [{ type: 'git', url: 'https://example.com/widgets/' }, 'https://example.com/widgets'],
      [{ type: 'git' }, null],
      ['', null],
      [undefined, null],
    ];
    for (const [input, url] of cases) expect(repositoryUrl(input)).toBe(url);
  });
});

describe('licenseFiles', () => {
  it('reads license files first, then notices, and tidies the text', () => {
    const dir = makeTree({
      'NOTICE.md': 'Notice text',
      'LICENSE-MIT': 'MIT text\r\nline two   \r\n',
      'licence.txt': '\uFEFFBritish spelling',
      COPYING: 'Copying text',
      'LICENSE-APACHE': '   ',
      'license.js': 'module.exports = {};',
      'README.md': 'not a license',
      'LICENSE.d/MIT.txt': 'a folder, not a file',
    });
    fs.writeFileSync(path.join(dir, 'LICENSE.bin'), Buffer.from([0x4d, 0x00, 0x49]));
    expect(licenseFiles(dir)).toEqual([
      { file: 'COPYING', text: 'Copying text' },
      { file: 'licence.txt', text: 'British spelling' },
      { file: 'LICENSE-MIT', text: 'MIT text\nline two' },
      { file: 'NOTICE.md', text: 'Notice text' },
    ]);
  });
});

describe('renderNotices', () => {
  const entry = (name: string, version: string, files: { file: string; text: string }[] = []) => ({
    name,
    version,
    license: 'MIT',
    repository: name === 'zeta' ? null : `https://example.com/${name}`,
    files,
  });

  it('lists the packages in a stable order with their license texts', () => {
    const text = renderNotices([
      entry('zeta', '1.0.0'),
      entry('alpha', '2.0.0', [{ file: 'LICENSE', text: 'Use `x` or ```y```.' }]),
      entry('alpha', '10.0.0'),
    ]);
    expect(text).toMatch(/^# Third-party notices\n/);
    expect(text).toContain('Packages: 3');
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(['alpha 10.0.0', 'alpha 2.0.0', 'zeta 1.0.0']);
    expect(text).toContain(
      '## alpha 2.0.0\n\n- License: MIT\n- Repository: https://example.com/alpha\n',
    );
    expect(text).toContain('### LICENSE\n\n````text\nUse `x` or ```y```.\n````\n');
    expect(text).toContain(
      '## zeta 1.0.0\n\n- License: MIT\n- Repository: not listed\n\n_No license or notice file in the package._\n',
    );
    expect(text.endsWith('\n')).toBe(true);
    expect(renderNotices([entry('alpha', '10.0.0'), entry('zeta', '1.0.0')])).toBe(
      renderNotices([entry('zeta', '1.0.0'), entry('alpha', '10.0.0')]),
    );
  });
});
