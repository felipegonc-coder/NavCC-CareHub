import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VIEW_LAYOUTS } from '@carehub/databases';
import { LAYOUTS } from './layouts';
import NotBuilt from './shell/not-built';
import { jobsDatabase, layoutProps, VIEWS } from './test-utils';

describe('LAYOUTS', () => {
  it('has a component for every layout', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual([...VIEW_LAYOUTS].sort());
  });
});

describe('NotBuilt', () => {
  it('names the layout that is still to come', () => {
    const meta = jobsDatabase();
    const board = meta.views.find((v) => v.id === VIEWS.board);
    render(<NotBuilt {...layoutProps({ meta, view: board })} />);
    expect(screen.getByText("Board views aren't ready yet.")).toBeInTheDocument();
  });
});
