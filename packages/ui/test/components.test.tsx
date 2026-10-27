import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Avatar, Logo, Tabs, TabsContent, TabsList, TabsTrigger } from '../src';

describe('Tabs', () => {
  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="details">
        <TabsList aria-label="Ticket">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details">Opened by Sam Rivers</TabsContent>
        <TabsContent value="history">Two replies</TabsContent>
      </Tabs>,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    const history = screen.getByRole('tab', { name: 'History' });
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Two replies');
  });
});

describe('Avatar and Logo', () => {
  it('are named images unless marked decorative', () => {
    render(
      <>
        <Avatar name="Priya Nandakumar" />
        <Logo />
        <Logo decorative data-testid="quiet-logo" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Priya Nandakumar' })).toHaveTextContent('PN');
    expect(screen.getByRole('img', { name: 'Care Hub' })).toBeInTheDocument();
    expect(screen.getByTestId('quiet-logo')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
