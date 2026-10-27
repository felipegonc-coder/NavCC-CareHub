import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, UNKNOWN_ERROR_MESSAGE } from '../api';
import { LoadError, LoadingRows, NoMatches, NoRows, OverrideBar } from './states';

describe('LoadingRows', () => {
  it('shows a header and 5 row bars for a table, after a moment', async () => {
    render(<LoadingRows layout="table" />);
    expect(screen.queryByTestId('database-loading')).toBeNull();
    const loading = await screen.findByTestId('database-loading');
    expect(loading.children).toHaveLength(6);
  });

  it('shows 3 cards for a board', async () => {
    render(<LoadingRows layout="board" />);
    expect((await screen.findByTestId('database-loading')).children).toHaveLength(3);
  });
});

describe('NoRows', () => {
  it('offers New and Import CSV when they are allowed', () => {
    const onNew = vi.fn();
    const onImportCsv = vi.fn();
    render(<NoRows onNew={onNew} onImportCsv={onImportCsv} />);
    expect(screen.getByText('No rows yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onImportCsv).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to someone who can only view', () => {
    render(<NoRows />);
    expect(screen.getByText('No rows yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('NoMatches', () => {
  it('offers Clear filters and Clear search for whichever is on', () => {
    const onClearFilters = vi.fn();
    const onClearSearch = vi.fn();
    render(<NoMatches onClearFilters={onClearFilters} onClearSearch={onClearSearch} />);
    expect(screen.getByText('No rows match.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});

describe('LoadError', () => {
  it("gives the server's reason and Retry", () => {
    const onRetry = vi.fn();
    render(
      <LoadError
        error={new ApiError(500, 'server_error', 'Care Hub is busy. Try again in a minute.')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Care Hub is busy. Try again in a minute.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says something went wrong when there is no reason', () => {
    render(<LoadError error={new Error('boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(UNKNOWN_ERROR_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('OverrideBar', () => {
  it('says the view changed for this person only, with Reset', () => {
    const onReset = vi.fn();
    render(<OverrideBar onReset={onReset} />);
    expect(screen.getByText('Changed for you only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
