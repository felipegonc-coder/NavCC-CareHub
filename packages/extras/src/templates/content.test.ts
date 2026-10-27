import { describe, expect, it } from 'vitest';
import {
  escapeMarkdown,
  fillPageTokens,
  fillVariables,
  readVariable,
  tokenizePageIds,
  variableLabel,
} from './content';

const top = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c';
const sub = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const other = '11111111-2222-4333-8444-555555555555';
const chip = (kind: string, offsetDays?: number) =>
  `<!-- carehub:inline ${JSON.stringify({
    type: 'templateVariable',
    attrs: offsetDays === undefined ? { kind } : { kind, offsetDays },
  })} -->`;

describe('page tokens', () => {
  it('turns links to the template’s own pages into tokens and back into the copies', () => {
    const markdown = `See [Agenda](</p/${sub}>) and [Wiki](</p/${other}>).\n\n<!-- carehub:block {"type":"page","attrs":{"pageId":"${sub.toUpperCase()}"}} -->`;
    const keys = new Map([
      [top, 0],
      [sub, 1],
    ]);
    const stored = tokenizePageIds(markdown, keys);
    expect(stored).toContain('</p/{{template-page:1}}>');
    expect(stored).toContain(other);
    expect(stored).not.toContain(sub);
    expect(stored).toContain('"pageId":"{{template-page:1}}"');
    const copy = fillPageTokens(stored, new Map([[1, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']]));
    expect(copy).toContain('</p/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee>');
    expect(copy).toContain(other);
  });
});

describe('variables', () => {
  it('reads chips and labels them', () => {
    expect(
      readVariable({ type: 'templateVariable', attrs: { kind: 'today', offsetDays: 3 } }),
    ).toEqual({
      kind: 'today',
      offsetDays: 3,
    });
    expect(readVariable({ type: 'templateVariable', attrs: { kind: 'yesterday' } })).toBeNull();
    expect(readVariable({ type: 'mention', attrs: { kind: 'me' } })).toBeNull();
    expect(variableLabel('today', 3)).toBe('Today + 3 days');
    expect(variableLabel('now', -1)).toBe('Now − 1 day');
    expect(variableLabel('me', 4)).toBe('Me');
    expect(variableLabel('this_page')).toBe('This page');
  });

  it('fills chips and leaves other placeholders alone', () => {
    const button = '<!-- carehub:inline {"type":"emoji","attrs":{"name":"wave"}} -->';
    const markdown = `Due ${chip('today', 3)}, owner ${chip('me')} ${button}`;
    const filled = fillVariables(markdown, (kind, offsetDays) => `[${kind}${offsetDays}]`);
    expect(filled).toBe(`Due [today3], owner [me0] ${button}`);
  });

  it('escapes text so it reads back as itself', () => {
    expect(escapeMarkdown('Sam *Ortiz* <3\n#1')).toBe('Sam \\*Ortiz\\* \\<3 \\#1');
  });
});
