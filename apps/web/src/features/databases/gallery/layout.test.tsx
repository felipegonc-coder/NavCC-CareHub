import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@carehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultView, type FileRef, type Property, type View } from '@carehub/databases';
import type { LayoutProps, QueryRow } from '../contract';
import {
  groupedByStatus,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  layoutProps,
  PROPS,
  queryData,
  STATUS,
  viewData,
} from '../test-utils';
import GalleryLayout from './layout';

function galleryView(patch: Partial<View> = {}): View {
  return {
    ...defaultView('gallery', jobsProperties(), { name: 'Job photos' }),
    id: 'view-gallery',
    ...patch,
  };
}

function renderGallery(overrides: Partial<Omit<LayoutProps, 'actions'>> = {}) {
  const props = layoutProps({ view: galleryView(), ...overrides });
  const gallery = (next: LayoutProps) => (
    <ToastProvider>
      <GalleryLayout {...next} />
    </ToastProvider>
  );
  const result = render(gallery(props));
  return {
    ...result,
    props,
    actions: props.actions,
    redraw: (patch: Partial<LayoutProps>) => result.rerender(gallery({ ...props, ...patch })),
  };
}

const card = (rowId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`article[data-row-id="${rowId}"]`);
  if (!found) throw new Error(`No card ${rowId}`);
  return found;
};
const opener = (rowId: string): HTMLElement => {
  const found = card(rowId).querySelector<HTMLElement>('[data-card-open]');
  if (!found) throw new Error(`No title on ${rowId}`);
  return found;
};
const cardIds = (el: ParentNode = document) =>
  [...el.querySelectorAll('article[data-row-id]')].map((a) => a.getAttribute('data-row-id'));
const grid = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-board-slot]');
  if (!found) throw new Error('No grid');
  return found;
};
const section = (key: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-testid="gallery-group"]')].find(
    (el) => el.dataset.groupKey === key,
  );
  if (!found) throw new Error(`No group ${key}`);
  return found;
};

const picture = (id: string, name: string): FileRef => ({
  id,
  name,
  size: 2048,
  mime: 'image/jpeg',
});

/** Rows as the answer gives them, with a cover or a picture from the content on some. */
function withPictures(extra: Record<string, { cover?: FileRef; contentPicture?: FileRef }>) {
  const data = queryData();
  const rows = data.rows.map((r): QueryRow => {
    const fields = extra[r.id];
    return fields ? Object.assign({ ...r }, fields) : r;
  });
  return viewData({ ...data, rows });
}

/** jsdom draws nothing: cards stand three to a line, 200 px apart and 150 px between lines. */
function layOutGrid() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
    if (this.matches('[data-board-slot]')) return box(0, 0, 600, 600);
    if (this.matches('article[data-row-id]')) {
      const index = [...document.querySelectorAll('article[data-row-id]')].indexOf(this);
      return box((index % 3) * 200, Math.floor(index / 3) * 150, 180, 140);
    }
    return box(0, 0, 0, 0);
  });
}

function pointer(target: Element | Window, type: string, x: number, y: number) {
  fireEvent(
    target,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GalleryLayout cards', () => {
  it('draws a card per row in a grid as wide as the card size', () => {
    const { redraw, props } = renderGallery();
    expect(cardIds()).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(screen.getByRole('article', { name: 'Fix kitchen sink leak' })).toBe(card('row-sink'));
    expect(grid().style.gridTemplateColumns).toMatch(/240px/);
    const small = galleryView({
      gallery: { cardPreview: { kind: 'none' }, cardSize: 's', fitImage: false },
    });
    redraw({ view: small, data: props.data });
    expect(grid().style.gridTemplateColumns).toMatch(/180px/);
  });

  it('shows the page cover by default, cropped to fill', () => {
    renderGallery({
      data: withPictures({ 'row-sink': { cover: picture('file-cover', 'van.jpg') } }),
    });
    const cover = card('row-sink').querySelector('img');
    expect(cover).toHaveAttribute('src', '/api/files/file-cover');
    expect(cover).toHaveClass('object-cover', 'h-32');
    expect(card('row-heater').querySelector('img')).toBeNull();
  });

  it('shows the first picture in the page content when the view asks for it', () => {
    const view = galleryView({
      gallery: { cardPreview: { kind: 'content' }, cardSize: 's', fitImage: true },
    });
    const data = withPictures({
      'row-sink': { cover: picture('file-cover', 'van.jpg') },
      'row-heater': { contentPicture: picture('file-heater', 'heater.png') },
    });
    renderGallery({ view, data });
    expect(card('row-sink').querySelector('img')).toBeNull();
    const shown = card('row-heater').querySelector('img');
    expect(shown).toHaveAttribute('src', '/api/files/file-heater');
    expect(shown).toHaveClass('object-contain', 'h-20');
  });

  it('shows the first picture of a Files property, on large cards', () => {
    const photos: Property = {
      id: 'prop-photos',
      name: 'Photos',
      description: '',
      config: { type: 'files' },
      rowPage: 'always',
    };
    const meta = jobsDatabase({ properties: [...jobsProperties(), photos] });
    const notes: FileRef = {
      id: 'file-notes',
      name: 'notes.pdf',
      size: 900,
      mime: 'application/pdf',
    };
    const rows = jobsRows().map((r) =>
      r.id === 'row-drain'
        ? {
            ...r,
            values: { ...r.values, [photos.id]: [notes, picture('file-drain', 'drain.jpg')] },
          }
        : r,
    );
    const view = galleryView({
      gallery: {
        cardPreview: { kind: 'files', propertyId: photos.id },
        cardSize: 'l',
        fitImage: false,
      },
    });
    renderGallery({ meta, view, data: viewData(queryData(rows)) });
    const shown = card('row-drain').querySelector('img');
    expect(shown).toHaveAttribute('src', '/api/files/file-drain');
    expect(shown).toHaveClass('h-48');
  });

  it('shows the properties the view shows', () => {
    const view = galleryView({
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.priority, visible: true },
      ],
    });
    renderGallery({ view });
    expect(within(card('row-heater')).getByText('High')).toBeInTheDocument();
    expect(card('row-heater').querySelector(`[data-property-id="${PROPS.cost}"]`)).toBeNull();
  });

  it('opens a card on click and moves focus with the arrow keys', () => {
    const { actions } = renderGallery();
    fireEvent.click(opener('row-boiler'));
    expect(actions.openRow).toHaveBeenCalledWith('row-boiler');
    opener('row-sink').focus();
    fireEvent.keyDown(opener('row-sink'), { key: 'ArrowRight' });
    expect(opener('row-heater')).toHaveFocus();
    fireEvent.keyDown(opener('row-heater'), { key: 'ArrowLeft' });
    expect(opener('row-sink')).toHaveFocus();
  });

  it('"+ New" adds a card at the end and edits its title in place', async () => {
    const { actions } = renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(actions.createRow).toHaveBeenCalledWith({});
    const input = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Call back Blue Pine Plumbing' } });
    fireEvent.blur(input);
    expect(actions.updateValues).toHaveBeenCalledWith('row-new', {
      [PROPS.name]: 'Call back Blue Pine Plumbing',
    });
    expect(cardIds().at(-1)).toBe('row-new');
  });

  it('"Load more" asks for the next page', () => {
    const data = queryData(jobsRows(), { count: 90, nextCursor: 'cursor-2' });
    const { actions } = renderGallery({ data: viewData(data) });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(actions.loadMore).toHaveBeenCalledWith();
  });

  it('offers no New when read-only', () => {
    renderGallery({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });
});

describe('GalleryLayout moves', () => {
  it('moves a card by keyboard: Space picks it up, arrows move it, Space drops it', () => {
    const { actions } = renderGallery();
    const sink = opener('row-sink');
    fireEvent.keyDown(sink, { key: ' ' });
    expect(card('row-sink')).toHaveClass('ring-2');
    fireEvent.keyDown(sink, { key: 'ArrowRight' });
    expect(screen.getByText('Job photos, 2 of 4')).toBeInTheDocument();
    expect(card('row-boiler').parentElement?.querySelector('[data-drop-indicator]')).not.toBeNull();
    fireEvent.keyDown(sink, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-sink', { beforeRowId: 'row-boiler' });
  });

  it('drags a card to a new place in the grid', () => {
    const { actions } = renderGallery();
    layOutGrid();
    pointer(card('row-drain'), 'pointerdown', 50, 200);
    pointer(window, 'pointermove', 56, 200);
    // Its own place changes nothing.
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
    pointer(window, 'pointermove', 210, 70);
    expect(card('row-heater').parentElement?.querySelector('[data-drop-indicator]')).not.toBeNull();
    pointer(window, 'pointerup', 210, 70);
    expect(actions.moveRow).toHaveBeenCalledWith('row-drain', { beforeRowId: 'row-heater' });
  });

  it('draws groups in sections that collapse, and moves cards between them', () => {
    const view = galleryView({ grouping: { propertyId: PROPS.status } });
    const { actions } = renderGallery({ view, data: viewData(groupedByStatus()) });
    const keys = screen.getAllByTestId('gallery-group').map((el) => el.dataset.groupKey);
    expect(keys).toEqual([STATUS.notStarted, STATUS.inProgress, STATUS.done]);
    expect(cardIds(section(STATUS.notStarted))).toEqual(['row-heater', 'row-drain']);
    fireEvent.click(within(section(STATUS.done)).getByRole('button', { name: /^Done/ }));
    expect(cardIds(section(STATUS.done))).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Card menu for Fix kitchen sink leak' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Not started' }));
    expect(actions.moveRow).toHaveBeenCalledWith('row-sink', {
      beforeRowId: 'row-heater',
      fromGroupKey: STATUS.inProgress,
      toGroupKey: STATUS.notStarted,
    });
    expect(screen.getByText("Moved 'Fix kitchen sink leak' to Not started")).toBeInTheDocument();
  });

  it('keeps a sorted gallery in its order: the arrows go straight to the next group', () => {
    const view = galleryView({
      grouping: { propertyId: PROPS.status },
      sorts: [{ propertyId: PROPS.cost, direction: 'desc' }],
    });
    const { actions } = renderGallery({ view, data: viewData(groupedByStatus()) });
    const heater = opener('row-heater');
    fireEvent.keyDown(heater, { key: ' ' });
    fireEvent.keyDown(heater, { key: 'ArrowRight' });
    expect(screen.getByText('In progress, 1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(heater, { key: ' ' });
    expect(actions.moveRow).toHaveBeenCalledWith('row-heater', {
      beforeRowId: 'row-sink',
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.inProgress,
    });
  });
});
