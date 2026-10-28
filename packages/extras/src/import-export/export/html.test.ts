import { describe, expect, it } from 'vitest';
import type { ContentNode } from './content';
import { pageToHtml } from './html';
import { exportHref, type ExportLinks } from './render';

// Fictional pages: "Escalation steps" is in the export and "Payroll" can't be opened.
const STEPS = '11111111-1111-4111-8111-111111111111';
const PAYROLL = '33333333-3333-4333-8333-333333333333';
const CHART = '44444444-4444-4444-8444-444444444444';

const links: ExportLinks = {
  page: (id) =>
    id === STEPS
      ? { title: 'Escalation steps', href: 'Intake%20guide/Escalation%20steps.html' }
      : null,
  file: (id) => (id === CHART ? { name: 'chart.png', href: 'Intake%20guide/chart.png' } : null),
  href: (href) => exportHref(href, 'https://care.example.test'),
};
const text = (value: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text: value,
  marks,
});
const p = (...content: ContentNode[]): ContentNode => ({ type: 'paragraph', content });
const html = (...blocks: ContentNode[]) =>
  pageToHtml({ title: 'Intake guide', icon: '📋', blocks }, links, { style: 'body{margin:0}' });

describe('pageToHtml', () => {
  it('is one file with its styling inside, the title as the only h1, and no scripts', () => {
    const out = html(
      { type: 'heading', attrs: { level: 1 }, content: [text('Before the call')] },
      p(
        text('<script>alert(1)</script>'),
        text('click', { type: 'link', attrs: { href: 'javascript:alert(1)' } }),
      ),
      { type: 'image', attrs: { fileId: CHART, alt: '" onerror="alert(1)' } },
    );
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<style>body{margin:0}</style>');
    expect(out).toContain("script-src 'none'");
    expect(out).toContain(
      '<h1 class="page-title"><span class="page-icon">📋</span> Intake guide</h1>',
    );
    expect(out).toContain('<h2>Before the call</h2>');
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/\son\w+="/i);
    expect(out).toContain('alt="&quot; onerror=&quot;alert(1)"');
  });

  it('keeps a stylesheet from closing its own tag', () => {
    const out = pageToHtml({ title: 'A', blocks: [] }, links, {
      style: 'a{}</style><script>x</script>',
    });
    expect(out).not.toContain('</style><script>');
  });

  it('links exported pages relatively and pictures from their folder', () => {
    const out = html(
      p(text('See '), text('the steps', { type: 'link', attrs: { href: `/p/${STEPS}` } })),
      p({ type: 'mention', attrs: { kind: 'page', id: PAYROLL, label: 'Payroll 2026' } }),
      { type: 'image', attrs: { fileId: CHART, caption: 'Week 1' } },
    );
    expect(out).toContain('<a href="Intake%20guide/Escalation%20steps.html">the steps</a>');
    expect(out).toContain('<span class="mention">No access</span>');
    expect(out).not.toContain('Payroll 2026');
    expect(out).toContain(
      '<figure><img src="Intake%20guide/chart.png" alt="Week 1"><figcaption>Week 1</figcaption></figure>',
    );
  });

  it('writes toggles as details, callouts with their icon, task lists, tables and colours', () => {
    const out = html(
      {
        type: 'toggle',
        attrs: { open: false },
        content: [p(text('Refunds')), p(text('Send the form.'))],
      },
      {
        type: 'callout',
        attrs: { icon: '⚠️', color: 'red_background' },
        content: [p(text('Careful'))],
      },
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Called'))] }],
      },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(text('Name'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [p(text('Rowan'))] }] },
        ],
      },
      p(
        text('blue words', { type: 'textStyle', attrs: { color: 'blue' } }),
        text('no', { type: 'textStyle', attrs: { color: 'url(x)' } }),
      ),
    );
    expect(out).toContain(
      '<details><summary>Refunds</summary><div class="toggle-body"><p>Send the form.</p></div></details>',
    );
    expect(out).toContain(
      '<aside class="callout ch-bg-red"><span class="callout-icon" aria-hidden="true">⚠️</span>',
    );
    expect(out).toContain(
      '<li class="task done"><input type="checkbox" disabled checked><div><p>Called</p></div></li>',
    );
    expect(out).toContain(
      '<thead><tr><th><p>Name</p></th></tr></thead><tbody><tr><td><p>Rowan</p></td></tr></tbody>',
    );
    expect(out).toContain('<span class="ch-text-blue">blue words</span>no');
  });
});
