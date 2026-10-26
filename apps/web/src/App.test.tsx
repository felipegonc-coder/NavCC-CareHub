import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the home screen in one main landmark', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Care Hub' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
