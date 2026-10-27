import { richText, type AccordionBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { AccordionView } from './AccordionView';

const block: AccordionBlock = {
  id: 'acc_1',
  type: 'accordion',
  items: [
    { id: 'i1', title: 'Before touching a patient', body: richText('Clean your hands.') },
    { id: 'i2', title: 'After touching a patient', body: richText('Clean them again.') },
  ],
};

describe('AccordionView', () => {
  it('opens and closes each item from its title', () => {
    render(<AccordionView {...viewProps(block)} />);
    const first = screen.getByRole('button', { name: 'Before touching a patient' });
    const second = screen.getByRole('button', { name: 'After touching a patient' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Clean your hands.')).not.toBeVisible();

    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Clean your hands.')).toBeVisible();
    expect(screen.getByText('Clean them again.')).toBeVisible();
    expect(document.getElementById(first.getAttribute('aria-controls') ?? '')).toHaveTextContent(
      'Clean your hands.',
    );

    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Clean your hands.')).not.toBeVisible();
  });
});
