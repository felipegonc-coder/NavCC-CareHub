import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HomeSection, type HomeSectionProps, type SectionQuery } from './HomeSection';

type Item = { id: string; name: string; day?: string };

const loaded = (data: Item[]): SectionQuery<Item> => ({
  data,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

function renderSection(query: SectionQuery<Item>, extra: Partial<HomeSectionProps<Item>> = {}) {
  return render(
    <MemoryRouter>
      <HomeSection
        title="Reminders"
        link={{ label: 'See all', to: '/reminders', hint: 'reminders' }}
        query={query}
        limit={2}
        empty="No reminders. Use Remind me on a page or event."
        noun="your reminders"
        itemKey={(item) => item.id}
        renderItem={(item) => <a href={`/p/${item.id}`}>{item.name}</a>}
        {...extra}
      />
    </MemoryRouter>,
  );
}

describe('HomeSection', () => {
  it('is a region named by its heading, with its link', () => {
    renderSection(loaded([]));
    const region = screen.getByRole('region', { name: 'Reminders' });
    expect(
      within(region).getByRole('heading', { level: 2, name: 'Reminders' }),
    ).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'See all reminders' })).toHaveAttribute(
      'href',
      '/reminders',
    );
  });

  it('shows up to its limit, in order, and Tab reaches each one', () => {
    renderSection(
      loaded([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Bravo' },
        { id: 'c', name: 'Charlie' },
      ]),
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Alpha', 'Bravo']);
    expect(within(items[0]!).getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/p/a');
  });

  it('puts items under small headings when asked', () => {
    renderSection(
      loaded([
        { id: 'a', name: 'Alpha', day: 'Today' },
        { id: 'b', name: 'Bravo', day: 'Tomorrow' },
      ]),
      { groupOf: (item) => item.day ?? '' },
    );
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Today', 'Tomorrow']);
    expect(screen.getAllByRole('list')).toHaveLength(2);
  });

  it('says when there is nothing to show', () => {
    renderSection(loaded([]));
    expect(screen.getByText('No reminders. Use Remind me on a page or event.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says when it failed, and tries again', () => {
    const refetch = vi.fn();
    renderSection({ data: undefined, isPending: false, isError: true, isFetching: false, refetch });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your reminders.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(refetch.mock.calls).toHaveLength(1);
  });

  it('shows a skeleton only when loading takes a while', async () => {
    const pending = { data: undefined, isPending: true, isError: false, isFetching: true };
    renderSection({ ...pending, refetch: vi.fn() });
    expect(screen.queryByText('Loading your reminders')).toBeNull();
    expect(await screen.findByText('Loading your reminders')).toBeInTheDocument();
  });
});
