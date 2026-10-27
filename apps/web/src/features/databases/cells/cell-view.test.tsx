import type { ComputedValue, Property, PropertyConfig } from '@carehub/databases';
import { colorClasses } from '@carehub/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsProperties, PRIORITY, PROPS, STATUS, USERS } from '../fixtures';
import { CellView } from './cell-view';
import { CELL_TEXT } from './messages';
import { CUSTOMERS, cellCtx, numberConfig, prop } from './test-helpers';
import type { CellViewProps } from './types';

const jobs = jobsProperties();
function job(id: string): Property {
  const found = jobs.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
}

function show(property: Property, value: unknown, extra: Partial<CellViewProps> = {}) {
  return render(<CellView property={property} value={value} ctx={cellCtx()} {...extra} />);
}

const relation: PropertyConfig = {
  type: 'relation',
  targetDatabaseId: 'db-customers',
  single: false,
  twoWayPropertyId: null,
};
const formula = () =>
  prop({ type: 'formula', expression: '1', resultKind: 'number', number: null });

describe('CellView: text types', () => {
  it('shows the Name, or "Untitled" in grey when it has none', () => {
    show(job(PROPS.name), 'Fix kitchen sink leak');
    expect(screen.getByText('Fix kitchen sink leak')).toBeInTheDocument();
    show(job(PROPS.name), '');
    expect(screen.getByText(CELL_TEXT.untitled)).toHaveClass('text-muted');
  });

  it('shows rich text with its marks, links and mentions', () => {
    show(job(PROPS.notes), [
      { text: 'Call ' },
      { text: 'first', marks: ['bold', 'italic'] },
      { text: ', see ' },
      { text: 'the plans', link: 'https://example.com/plans' },
      { text: ' and ' },
      { text: 'this', link: 'javascript:alert(1)' },
      { text: ' ' },
      { text: '@Jordan', mention: { kind: 'user', id: USERS.jordan.id } },
      { text: ' ' },
      { text: 'code', marks: ['code'] },
    ]);
    expect(screen.getByText('first').closest('strong')).not.toBeNull();
    expect(screen.getByText('first').closest('em')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'the plans' })).toHaveAttribute(
      'href',
      'https://example.com/plans',
    );
    expect(screen.queryByRole('link', { name: 'this' })).toBeNull();
    expect(screen.getByText('@Jordan Park')).toBeInTheDocument();
    expect(screen.getByText('code').tagName).toBe('CODE');
  });

  it('links web addresses, emails and phone numbers', () => {
    show(prop({ type: 'url' }), 'https://example.com/plans');
    expect(screen.getByRole('link', { name: 'https://example.com/plans' })).toHaveAttribute(
      'target',
      '_blank',
    );
    show(prop({ type: 'email' }), 'avery@bluepine.example');
    expect(screen.getByRole('link', { name: 'avery@bluepine.example' })).toHaveAttribute(
      'href',
      'mailto:avery@bluepine.example',
    );
    show(prop({ type: 'phone' }), '(555) 010-2030 x12');
    expect(screen.getByRole('link', { name: '(555) 010-2030 x12' })).toHaveAttribute(
      'href',
      'tel:5550102030',
    );
  });

  it('shows nothing for an empty value', () => {
    const { container } = show(prop({ type: 'url' }), null);
    expect(container.textContent).toBe('');
  });

  it('shows an ID with its prefix', () => {
    show(prop({ type: 'unique_id', prefix: 'QA' }), '12');
    expect(screen.getByText('QA-12')).toBeInTheDocument();
  });
});

describe('CellView: numbers', () => {
  it('formats numbers, currency and percent', () => {
    show(prop(numberConfig()), '1234.5');
    expect(screen.getByText('1234.5')).toBeInTheDocument();
    show(prop(numberConfig({ format: 'number_commas' })), '1234.5');
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
    show(job(PROPS.cost), '12');
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    show(prop(numberConfig({ format: 'percent' })), '0.45');
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('fills a ring with 7 of 10 to 70% (DB-42)', () => {
    show(prop(numberConfig({ showAs: 'ring', divideBy: 10, color: 'green' })), '7');
    const ring = screen.getByRole('img', { name: '7 of 10' });
    expect(Number(ring.getAttribute('data-fill'))).toBeCloseTo(0.7);
    expect(within(ring).getByText('7')).toBeInTheDocument();
  });

  it('fills a bar out of 100 when no divide by is set, and can hide the number', () => {
    show(prop(numberConfig({ showAs: 'bar', showNumber: false })), '25');
    const bar = screen.getByRole('img', { name: '25 of 100' });
    expect(Number(bar.getAttribute('data-fill'))).toBeCloseTo(0.25);
    expect(within(bar).queryByText('25')).toBeNull();
  });
});

describe('CellView: options', () => {
  it('shows a select option and nothing for one that was deleted', () => {
    show(job(PROPS.priority), PRIORITY.high);
    expect(screen.getByText('High')).toBeInTheDocument();
    const { container } = show(job(PROPS.priority), 'opt-gone');
    expect(container.textContent).toBe('');
  });

  it('shows a status as a round chip', () => {
    show(job(PROPS.status), STATUS.inProgress);
    expect(screen.getByText('In progress').parentElement).toHaveClass('rounded-full');
  });

  it('shows multi-select options in the order they were picked', () => {
    const tags = prop({
      type: 'multi_select',
      options: [
        { id: 'opt-leak', name: 'Leak', color: 'blue' },
        { id: 'opt-urgent', name: 'Urgent', color: 'red' },
      ],
    });
    const { container } = show(tags, ['opt-urgent', 'opt-leak']);
    expect(container.textContent).toBe('UrgentLeak');
  });
});

describe('CellView: dates', () => {
  it('shows a date, a range and a time in the viewer’s zone', () => {
    const due = job(PROPS.due);
    show(due, { start: '2026-10-26', end: null, hasTime: false });
    expect(screen.getByText('Oct 26, 2026')).toBeInTheDocument();
    show(due, { start: '2026-10-26', end: '2026-10-28', hasTime: false });
    expect(screen.getByText('Oct 26, 2026 → Oct 28, 2026')).toBeInTheDocument();
    show(due, { start: '2026-10-26T15:00:00.000Z', end: null, hasTime: true });
    expect(screen.getByText('Oct 26, 2026 9:00 AM')).toBeInTheDocument();
  });

  it('shows a bell when there is a reminder', () => {
    show(job(PROPS.due), {
      start: '2026-10-26',
      end: null,
      hasTime: false,
      reminder: { daysBefore: 1 },
    });
    expect(screen.getByRole('img', { name: CELL_TEXT.reminder })).toBeInTheDocument();
  });

  it('shows when a row was created', () => {
    show(prop({ type: 'created_time', format: 'full', timeFormat: 'viewer' }), {
      start: '2026-10-20T16:00:00.000Z',
      end: null,
      hasTime: true,
    });
    expect(screen.getByText('Oct 20, 2026 10:00 AM')).toBeInTheDocument();
  });
});

describe('CellView: checkbox', () => {
  it('draws the box with "Checked" or "Unchecked" for screen readers', () => {
    show(job(PROPS.paid), true);
    expect(screen.getByRole('img', { name: CELL_TEXT.checked })).toBeInTheDocument();
    show(job(PROPS.paid), false);
    expect(screen.getByRole('img', { name: CELL_TEXT.unchecked })).toBeInTheDocument();
  });

  it('ticks straight from the cell', () => {
    const onToggle = vi.fn();
    show(job(PROPS.paid), false, { onToggle });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paid' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe('CellView: people', () => {
  it('shows people by name, removed members with "(removed)"', () => {
    render(
      <CellView
        property={prop({ type: 'person', single: false, notify: false })}
        value={[USERS.avery.id, USERS.jordan.id, 'user-unknown']}
        ctx={cellCtx({ isRemovedUser: (id) => id === USERS.jordan.id })}
      />,
    );
    expect(screen.getByText('Avery Lin')).toBeInTheDocument();
    expect(screen.getByText('Jordan Park (removed)').parentElement).toHaveClass('text-muted');
    expect(screen.queryByText('user-unknown')).toBeNull();
  });

  it('shows "Anonymous" for a form response nobody signed', () => {
    show(prop({ type: 'created_by' }), null);
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
    show(prop({ type: 'edited_by' }), [USERS.jordan.id]);
    expect(screen.getByText('Jordan Park')).toBeInTheDocument();
  });
});

describe('CellView: files', () => {
  it('opens uploads and web links in a new tab, with thumbnails for pictures', () => {
    render(
      <CellView
        property={prop({ type: 'files' })}
        value={[
          { id: 'file-invoice', name: 'invoice.pdf', size: 2048, mime: 'application/pdf' },
          { id: 'file-photo', name: 'leak.jpg', size: 4096, mime: 'image/jpeg' },
          {
            id: 'file-plans',
            name: 'plans.pdf',
            size: 0,
            mime: '',
            url: 'https://example.com/plans.pdf',
          },
        ]}
        ctx={cellCtx({ fileHref: (f) => `/api/uploads/${f.id}` })}
      />,
    );
    expect(screen.getByRole('link', { name: 'invoice.pdf' })).toHaveAttribute(
      'href',
      '/api/uploads/file-invoice',
    );
    expect(screen.getByRole('link', { name: 'plans.pdf' })).toHaveAttribute(
      'href',
      'https://example.com/plans.pdf',
    );
    const photo = screen.getByRole('link', { name: 'leak.jpg' });
    expect(photo.querySelector('img')).toHaveAttribute('src', '/api/uploads/file-photo');
  });
});

describe('CellView: relations', () => {
  it('titles the rows the viewer can open and counts the others', () => {
    render(
      <CellView
        property={prop(relation)}
        value={[CUSTOMERS.bluePine, CUSTOMERS.untitled, CUSTOMERS.hidden]}
        hiddenLinks={2}
        ctx={cellCtx({ rowHref: (id) => `/rows/${id}` })}
      />,
    );
    expect(screen.getByRole('link', { name: 'Blue Pine Plumbing' })).toHaveAttribute(
      'href',
      `/rows/${CUSTOMERS.bluePine}`,
    );
    expect(screen.getByText(CELL_TEXT.untitled)).toBeInTheDocument();
    expect(screen.getByText("3 rows you can't open")).toBeInTheDocument();
  });

  it('says "1 row you can\'t open" when that is all there is', () => {
    show(prop(relation), [], { hiddenLinks: 1 });
    expect(screen.getByText("1 row you can't open")).toBeInTheDocument();
  });
});

describe('CellView: checklist', () => {
  it('shows how many items are done', () => {
    show(prop({ type: 'checklist' }), [
      { id: 'item-call', text: 'Call back', done: true },
      { id: 'item-recap', text: 'Send recap', done: false },
    ]);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });
});

describe('CellView: formulas and rollups', () => {
  const result = (computed: ComputedValue, property = formula()) =>
    show(property, null, { computed });

  it('shows the result', () => {
    result({ kind: 'number', value: 42 });
    expect(screen.getByText('42')).toBeInTheDocument();
    result({ kind: 'boolean', value: true });
    expect(screen.getByRole('img', { name: CELL_TEXT.checked })).toBeInTheDocument();
    result({ kind: 'text', value: 'Call first', rich: [{ text: 'Call first', marks: ['bold'] }] });
    expect(screen.getByText('Call first').tagName).toBe('STRONG');
  });

  it('reads a result passed as the value', () => {
    show(formula(), { kind: 'text', value: 'Blue Pine Plumbing' });
    expect(screen.getByText('Blue Pine Plumbing')).toBeInTheDocument();
  });

  it('shows a number result as a ring', () => {
    const ring = prop({
      type: 'rollup',
      relationPropertyId: 'prop-jobs',
      targetPropertyId: 'prop-done',
      aggregate: 'sum',
      number: {
        format: 'number',
        currency: 'USD',
        decimals: 'auto',
        showAs: 'ring',
        color: 'blue',
        divideBy: 10,
        showNumber: true,
      },
    });
    result({ kind: 'number', value: 7 }, ring);
    expect(screen.getByRole('img', { name: '7 of 10' })).toBeInTheDocument();
  });

  it('shows "⚠ Formula error" with the reason on hover', () => {
    result({ kind: 'error', message: 'Unknown property "Cost total".' });
    expect(screen.getByText(CELL_TEXT.formulaError)).toHaveAttribute(
      'title',
      'Unknown property "Cost total".',
    );
  });

  it('keeps a message that already says what went wrong', () => {
    result({ kind: 'error', message: '⚠ Circular reference' });
    expect(screen.getByText('⚠ Circular reference')).not.toHaveAttribute('title');
  });
});

describe('CellView: buttons', () => {
  const button = (
    label: string,
    actions = [{ kind: 'open_link' as const, url: 'https://example.com' }],
  ) => prop({ type: 'button', label, actions, icon: '✅', color: 'green' }, 'Actions');

  it('is greyed out with the reason when it can’t be pressed', () => {
    show(button('Mark paid'), null);
    const press = screen.getByRole('button', { name: 'Mark paid' });
    expect(press).toHaveAttribute('aria-disabled', 'true');
    expect(press).toHaveAttribute('title', CELL_TEXT.pressBlocked);
    show(button('Send recap'), null, { pressBlockedReason: 'Only Avery Lin can press this' });
    expect(screen.getByRole('button', { name: 'Send recap' })).toHaveAttribute(
      'title',
      'Only Avery Lin can press this',
    );
  });

  it('asks for an action when it has none', () => {
    const onPress = vi.fn();
    show(button('Mark paid', []), null, { onPress });
    const press = screen.getByRole('button', { name: 'Mark paid' });
    expect(press).toHaveAttribute('title', CELL_TEXT.addAction);
    fireEvent.click(press);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the property name when the label is blank', () => {
    show(button('  '), null, { onPress: vi.fn() });
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  it('spins while it runs, ignores more presses, then shows Done', async () => {
    let finish = () => {};
    const onPress = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    show(button('Mark paid'), null, { onPress });
    const press = screen.getByRole('button', { name: 'Mark paid' });
    fireEvent.click(press);
    expect(press).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(CELL_TEXT.running);
    fireEvent.click(press);
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(press).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent(CELL_TEXT.done);
  });

  it('goes back to the button when the actions fail', async () => {
    const onPress = vi.fn(() => Promise.reject(new Error('Network')));
    show(button('Mark paid'), null, { onPress });
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});

describe('CellView: verification', () => {
  const verification = prop({ type: 'verification' }, 'Verification');
  const verified = {
    state: 'verified',
    verifiedBy: USERS.jordan.id,
    verifiedAt: '2026-10-20T15:00:00Z',
    until: '2027-01-20',
  };

  it('shows who verified it and until when, in green with a check', () => {
    const { container } = show(verification, verified);
    const text = screen.getByText('Verified by Jordan Park until Jan 20, 2027');
    expect(text.parentElement).toHaveClass(colorClasses.green.bg);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    show(verification, { ...verified, until: null });
    expect(screen.getByText('Verified by Jordan Park')).toBeInTheDocument();
  });

  it('shows an expired one in orange with its date', () => {
    const { container } = show(verification, {
      ...verified,
      state: 'expired',
      until: '2026-10-01',
    });
    const text = screen.getByText('Verification expired Oct 1, 2026');
    expect(text.parentElement).toHaveClass(colorClasses.orange.bg);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('says Not verified in grey, as a state rather than an empty cell', () => {
    show(verification, null);
    show(verification, { state: 'verified' });
    const shown = screen.getAllByText('Not verified');
    expect(shown).toHaveLength(2);
    expect(shown[0]).toHaveClass('text-muted');
  });

  it('marks a removed verifier, and leaves out one it does not know', () => {
    const ctx = cellCtx({ isRemovedUser: (id) => id === USERS.jordan.id });
    render(<CellView property={verification} value={verified} ctx={ctx} />);
    expect(
      screen.getByText('Verified by Jordan Park (removed) until Jan 20, 2027'),
    ).toBeInTheDocument();
    show(verification, { ...verified, verifiedBy: 'user-unknown' });
    expect(screen.getByText('Verified until Jan 20, 2027')).toBeInTheDocument();
  });
});
