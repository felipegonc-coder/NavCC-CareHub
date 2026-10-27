import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinRequest, SpaceMember, SpaceMembers as Members, SpaceRole } from './api';
import { SpaceMembers } from './SpaceMembers';

const { api, toast, Refused } = vi.hoisted(() => {
  /** Stands in for ApiError. */
  class Refused extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      patch: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    toast: vi.fn(),
    Refused,
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast }),
}));

// Radix measures, scrolls and captures the pointer; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

// Fictional people.
const ana: SpaceMember = {
  id: 'u1',
  type: 'user',
  name: 'Ana Ruiz',
  email: 'ana@example.org',
  role: 'owner',
};
const nightShift: SpaceMember = { id: 'g1', type: 'group', name: 'Night shift', role: 'member' };
const asking = (id: string, name: string): JoinRequest => ({
  id,
  user: { id: `u-${id}`, name, email: `${name.split(' ')[0]?.toLowerCase()}@example.org` },
  requestedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
});
const people = [
  { id: 'u1', name: 'Ana Ruiz', email: 'ana@example.org' },
  { id: 'u4', name: 'Dan Moss', email: 'dan@example.org' },
  { id: 'u7', name: 'Hana Lee', email: 'hana@example.net', isGuest: true },
];
const groups = [
  { id: 'g2', name: 'Handover leads', memberIds: ['u1', 'u4'] },
  { id: 'g3', name: 'Kitchen', memberIds: [] },
];

/** What the fake server's GET /members answers; the requests the screen sends change it. */
let server: Members;
const idIn = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function show(start: Members) {
  server = start;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SpaceMembers space={{ id: 'care', name: 'Care team' }} />
    </QueryClientProvider>,
  );
}

const membersList = () => screen.findByRole('list', { name: 'Members' });
/** Opens a Select from the keyboard and picks `name`. */
async function choose(select: HTMLElement, name: string) {
  fireEvent.keyDown(select, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => {
    if (path === '/api/spaces/care/members') return server;
    if (path.startsWith('/api/workspace/members?q=')) {
      const query = decodeURIComponent(path.split('=')[1] ?? '').toLowerCase();
      return { members: people.filter((person) => person.name.toLowerCase().includes(query)) };
    }
    if (path === '/api/workspace/groups') return { groups };
    throw new Error(`Unexpected GET ${path}`);
  });
  api.patch.mockImplementation(async (path, body) => {
    const { role } = body as { role: SpaceRole };
    const members = server.members.map((m) => (m.id === idIn(path) ? { ...m, role } : m));
    server = { ...server, members };
    return null;
  });
  api.delete.mockImplementation(async (path) => {
    server = { ...server, members: server.members.filter((m) => m.id !== idIn(path)) };
    return null;
  });
  api.post.mockImplementation(async (path, body) => {
    if (path === '/api/spaces/care/members') {
      const { type, id, role } = body as Pick<SpaceMember, 'type' | 'id' | 'role'>;
      const name = [...people, ...groups].find((who) => who.id === id)?.name ?? id;
      server = { ...server, members: [...server.members, { type, id, name, role }] };
      return null;
    }
    const { approve } = body as { approve: boolean };
    const request = server.requests.find((r) => r.id === idIn(path));
    const joined: SpaceMember[] =
      approve && request ? [{ type: 'user', ...request.user, role: 'member' }] : [];
    server = {
      members: [...server.members, ...joined],
      requests: server.requests.filter((r) => r !== request),
    };
    return null;
  });
});

describe('SpaceMembers', () => {
  it('lists the members and owners, and who is asking to join', async () => {
    show({ members: [ana, nightShift], requests: [asking('r1', 'Ben Okafor')] });
    const list = await membersList();
    expect(within(list).getByRole('combobox', { name: 'Role of Ana Ruiz' })).toHaveTextContent(
      'Owner',
    );
    expect(within(list).getByRole('combobox', { name: 'Role of Night shift' })).toHaveTextContent(
      'Member',
    );
    expect(within(list).getByText('ana@example.org')).toBeInTheDocument();
    expect(within(list).getByText('Group')).toBeInTheDocument();
    expect(screen.getByText(/^2 members\./)).toBeInTheDocument();
    const requests = screen.getByRole('list', { name: 'Asking to join' });
    expect(within(requests).getByText('Ben Okafor')).toBeInTheDocument();
    expect(within(requests).getByText('ben@example.org · Asked 3 hours ago')).toBeInTheDocument();
  });

  it('approves and declines requests to join', async () => {
    show({ members: [ana], requests: [asking('r1', 'Ben Okafor'), asking('r2', 'Cleo Park')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Ben Okafor' }));
    expect(api.post).toHaveBeenCalledWith('/api/spaces/care/requests/r1', { approve: true });
    // Focus moves on to the next request rather than getting lost.
    expect(screen.getByRole('button', { name: 'Approve Cleo Park' })).toHaveFocus();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve Ben Okafor' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ben Okafor is in “Care team” now.' }),
      ),
    );
    expect(await within(await membersList()).findByText('Ben Okafor')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Decline Cleo Park' }));
    expect(api.post).toHaveBeenCalledWith('/api/spaces/care/requests/r2', { approve: false });
    expect(screen.getByRole('button', { name: 'Add members' })).toHaveFocus();
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Asking to join' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Declined Cleo Park's request." }),
      ),
    );
  });

  it('changes roles, but always keeps an owner', async () => {
    show({ members: [ana, nightShift], requests: [] });
    const list = await membersList();
    const anasRole = within(list).getByRole('combobox', { name: 'Role of Ana Ruiz' });
    await choose(anasRole, 'Member');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '“Care team” needs an owner.' }),
    );
    expect(anasRole).toHaveTextContent('Owner');
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Ana Ruiz' }));
    expect(toast).toHaveBeenCalledTimes(2);
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();

    const groupsRole = within(list).getByRole('combobox', { name: 'Role of Night shift' });
    await choose(groupsRole, 'Owner');
    expect(api.patch).toHaveBeenCalledWith('/api/spaces/care/members/g1', { role: 'owner' });
    await waitFor(() => expect(groupsRole).toHaveTextContent('Owner'));
  });

  it("says why when the server won't let a space lose its last owner", async () => {
    show({ members: [ana, { ...nightShift, role: 'owner' }], requests: [] });
    api.patch.mockRejectedValueOnce(new Refused(409, 'A space needs an owner.'));
    const role = within(await membersList()).getByRole('combobox', { name: 'Role of Night shift' });
    await choose(role, 'Member');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '“Care team” needs an owner.',
          description: 'Make someone else an owner first.',
        }),
      ),
    );
    await waitFor(() => expect(role).toHaveTextContent('Owner'));
  });

  it('removes members, and puts them back if the server refuses', async () => {
    show({ members: [ana, nightShift], requests: [] });
    api.delete.mockRejectedValueOnce(new Refused(403, "You can't change this space."));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Night shift' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't remove Night shift.",
          description: "You can't change this space.",
        }),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Night shift' }));
    expect(api.delete).toHaveBeenLastCalledWith('/api/spaces/care/members/g1');
    expect(screen.getByRole('combobox', { name: 'Role of Ana Ruiz' })).toHaveFocus();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Night shift' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Removed Night shift from “Care team”.' }),
      ),
    );
    expect(await screen.findByText(/^1 member\./)).toBeInTheDocument();
  });

  it('finds people and groups to add, as members or owners', async () => {
    show({ members: [ana], requests: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Add members' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add members to “Care team”' });
    expect(within(dialog).getByText('Type a name or an email.')).toBeInTheDocument();
    const find = within(dialog).getByRole('searchbox', { name: 'Find people or groups' });

    fireEvent.change(find, { target: { value: 'zz' } });
    expect(await within(dialog).findByText('Nobody matches “zz”.')).toBeInTheDocument();

    fireEvent.change(find, { target: { value: 'an' } });
    const found = await within(dialog).findByRole('list', { name: 'People and groups' });
    expect(within(found).getByText('In the space')).toBeInTheDocument();
    expect(within(found).getByText("Guests can't join spaces")).toBeInTheDocument();
    expect(within(found).getByText('Group · 2 people')).toBeInTheDocument();
    expect(within(found).queryByText('Kitchen')).not.toBeInTheDocument();

    fireEvent.click(within(found).getByRole('button', { name: 'Add Handover leads' }));
    expect(api.post).toHaveBeenCalledWith('/api/spaces/care/members', {
      type: 'group',
      id: 'g2',
      role: 'member',
    });
    await choose(within(dialog).getByRole('combobox', { name: 'Add as' }), 'Owner');
    fireEvent.click(within(found).getByRole('button', { name: 'Add Dan Moss' }));
    expect(api.post).toHaveBeenLastCalledWith('/api/spaces/care/members', {
      type: 'user',
      id: 'u4',
      role: 'owner',
    });
    // The button stays, so focus does too.
    const added = await within(found).findByRole('button', { name: 'Added Dan Moss' });
    expect(added).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const list = await membersList();
    expect(
      await within(list).findByRole('combobox', { name: 'Role of Dan Moss' }),
    ).toHaveTextContent('Owner');
    expect(
      within(list).getByRole('combobox', { name: 'Role of Handover leads' }),
    ).toHaveTextContent('Member');
  });

  it("offers Retry when the members don't load", async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    show({ members: [ana], requests: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await membersList()).toBeInTheDocument();
  });
});
