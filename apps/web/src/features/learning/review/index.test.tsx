import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewScreen } from './index';

const TOKEN = 'q3J5_b-Z0xY7wV2uT9sR4pO1nM6lK8jI3hG5fE0dC2a';
const NOT_FOUND = 'This was deleted, or the link is wrong.';

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReviewScreen />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Review screen', () => {
  it('opens a link with its token in the fragment', () => {
    renderAt(`/learning/review#${TOKEN}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Review course' })).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it('says the link is wrong when the fragment has no token', () => {
    renderAt('/learning/review');
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    renderAt('/learning/review#not-a-token');
    expect(screen.getAllByText(NOT_FOUND)).toHaveLength(2);
  });
});
