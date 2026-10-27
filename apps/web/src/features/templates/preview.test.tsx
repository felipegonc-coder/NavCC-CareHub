import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { addToChoices, TemplatePreview } from './preview';
import { PreviewPage } from './preview-page';
import { CARDS, LAUNCH_ID, PAGE_ID, renderAt } from './test-utils';

const launch = CARDS.find((card) => card.id === LAUNCH_ID)!;

function renderPreview(onUse = vi.fn(), error: string | null = null) {
  renderAt(
    <TemplatePreview
      card={launch}
      onClose={vi.fn()}
      choices={addToChoices(null, null)}
      phone={false}
      pending={false}
      error={error}
      onUse={onUse}
    />,
  );
  return onUse;
}

describe('the template preview', () => {
  it('shows the top page, what comes with it and Include sample rows', async () => {
    renderPreview();
    const dialog = await screen.findByRole('dialog', { name: 'Launch plan' });
    expect(
      within(dialog).getByText('by Sam Ortiz · 1 sub-page, 1 database with 6 sample rows'),
    ).toBeInTheDocument();
    expect(await within(dialog).findByRole('heading', { name: 'Goals' })).toBeInTheDocument();
    const contents = within(dialog).getByRole('region', { name: 'What comes with it' });
    expect(within(contents).getByText('Q4 launch')).toBeInTheDocument();
    expect(within(contents).getByText('(database)')).toBeInTheDocument();
    expect(within(dialog).getByText('Add to: Private')).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Include sample rows' })).toBeChecked();
  });

  it('uses the template with the button or Ctrl+Enter', async () => {
    const onUse = renderPreview();
    const dialog = await screen.findByRole('dialog', { name: 'Launch plan' });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Include sample rows' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use template' }));
    expect(onUse).toHaveBeenLastCalledWith({ type: 'private' }, false);
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
    expect(onUse).toHaveBeenCalledTimes(2);
  });

  it('says why Use template failed', async () => {
    renderPreview(vi.fn(), 'Unlock the page first.');
    const dialog = await screen.findByRole('dialog', { name: 'Launch plan' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Unlock the page first.');
  });
});

describe('Add to:', () => {
  it('offers where the gallery was opened from first, then Private', () => {
    expect(addToChoices(null, null).map((choice) => choice.label)).toEqual(['Private']);
    const apply = addToChoices({ pageId: PAGE_ID, mode: 'apply' }, 'Q4 kickoff');
    expect(apply.map((choice) => choice.label)).toEqual(['This page (Q4 kickoff)', 'Private']);
    expect(apply[0]?.target).toEqual({ type: 'apply', pageId: PAGE_ID });
    const under = addToChoices({ pageId: PAGE_ID, mode: 'page' }, null);
    expect(under[0]).toMatchObject({
      label: 'Inside the page you came from',
      target: { type: 'page', pageId: PAGE_ID },
    });
  });
});

describe('PreviewPage', () => {
  it('reads headings, lists, to-dos, quotes and blocks it can’t draw', () => {
    render(
      <PreviewPage
        markdown={[
          '# Weekly huddle',
          '',
          '1. Wins',
          '   - Faster refunds',
          '2. Numbers',
          '',
          '- [x] Share the notes',
          '- [ ] Book the room',
          '',
          '> Keep it short.',
          '',
          '<!-- carehub:block {"type":"actionButton","attrs":{}} -->',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Weekly huddle' })).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('Done:')).toBeInTheDocument();
    expect(screen.getByText('To do:')).toBeInTheDocument();
    expect(screen.getByText('Keep it short.')).toBeInTheDocument();
    expect(screen.getByText('Button')).toBeInTheDocument();
  });

  it('says when the page is empty', () => {
    render(<PreviewPage markdown="" />);
    expect(screen.getByText('This page is empty.')).toBeInTheDocument();
  });
});
