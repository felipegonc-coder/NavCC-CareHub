import { describe, expect, it } from 'vitest';
import { rewriteMacros } from './macros';

function rewrite(html: string): { html: string; kept: Map<string, number> } {
  const body = new DOMParser().parseFromString(`<div id="main">${html}</div>`, 'text/html');
  const main = body.getElementById('main');
  if (!main) throw new Error('no content');
  const kept = rewriteMacros(main);
  return { html: main.innerHTML, kept };
}

const callout = (icon: string, body: string) =>
  `<aside class="callout"><span class="callout-icon">${icon}</span>` +
  `<div class="callout-body">${body}</div></aside>`;

describe('rewriteMacros', () => {
  it('makes info, note, warning and tip panels, and plain panels, callouts', () => {
    const { html, kept } = rewrite(
      '<div class="confluence-information-macro confluence-information-macro-information">' +
        '<p class="title">Before the call</p><span class="aui-icon confluence-information-macro-icon"></span>' +
        '<div class="confluence-information-macro-body"><p>Have the chart open.</p></div></div>' +
        '<div class="confluence-information-macro confluence-information-macro-warning conf-macro" ' +
        'data-macro-name="warning"><div class="confluence-information-macro-body"><p>Never share it.</p>' +
        '</div></div><div data-macro-name="tip"><p>Call early.</p></div>' +
        '<div class="panel"><div class="panelHeader"><b>Contacts</b></div>' +
        '<div class="panelContent"><p>Rowan Diaz</p></div></div>',
    );
    expect(html).toBe(
      callout('ℹ️', '<p><strong>Before the call</strong></p><p>Have the chart open.</p>') +
        callout('⚠️', '<p>Never share it.</p>') +
        callout('💡', '<p>Call early.</p>') +
        callout('📌', '<p><strong>Contacts</strong></p><p>Rowan Diaz</p>'),
    );
    expect(kept.size).toBe(0);
  });

  it('makes code macros code blocks, with their language and title', () => {
    const { html } = rewrite(
      '<div class="code panel pdl conf-macro" data-macro-name="code"><div class="codeHeader">' +
        '<b>Check the form</b></div><div class="codeContent"><pre class="syntaxhighlighter-pre" ' +
        'data-syntaxhighlighter-params="brush: js; gutter: false">if (form.signed) {\n  send(form);\n}\n' +
        '</pre></div></div><div class="preformatted panel"><div class="preformattedContent">' +
        '<pre>plain &lt;text&gt;</pre></div></div>',
    );
    expect(html).toBe(
      '<p><strong>Check the form</strong></p>' +
        '<pre><code class="language-javascript">if (form.signed) {\n  send(form);\n}</code></pre>' +
        '<pre><code>plain &lt;text&gt;</code></pre>',
    );
  });

  it('turns emoticons into emoji and task lists into to-dos, and drops icons and scripts', () => {
    const { html } = rewrite(
      '<p>Done <img class="emoticon emoticon-tick" src="images/icons/emoticons/check.svg" ' +
        'data-emoticon-name="tick" alt="(tick)"> <img class="emoticon" data-emoji-fallback="🙂" ' +
        'src="x.png"> <img src="images/icons/contenttypes/home.png"></p>' +
        '<ul class="inline-task-list"><li class="checked">Call</li><li>Write</li></ul>' +
        '<script>alert(1)</script>',
    );
    expect(html).toBe(
      '<p>Done ✅ 🙂 </p><ul class="inline-task-list" data-type="taskList">' +
        '<li class="checked" data-type="taskItem" data-checked="true">Call</li>' +
        '<li data-type="taskItem" data-checked="false">Write</li></ul>',
    );
  });

  it('keeps the text of other macros, and counts them by name', () => {
    const { html, kept } = rewrite(
      '<p>See <span class="jira-issue"><a href="https://jira.example.test/browse/CARE-1">CARE-1</a>' +
        '</span> <span class="status-macro aui-lozenge">DONE</span></p>' +
        '<div class="conf-macro output-block" data-macro-name="Children"><ul><li>Forms</li></ul></div>' +
        '<div data-macro-name="jira">CARE-2</div>',
    );
    expect(html).toBe(
      '<p>See <a href="https://jira.example.test/browse/CARE-1">CARE-1</a> DONE</p>' +
        '<ul><li>Forms</li></ul>CARE-2',
    );
    expect([...kept]).toEqual([
      ['jira', 2],
      ['status', 1],
      ['children', 1],
    ]);
  });
});
