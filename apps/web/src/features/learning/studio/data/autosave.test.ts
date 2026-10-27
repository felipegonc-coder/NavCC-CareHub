import { describe, expect, it } from 'vitest';
import { StudioError } from './client';
import { createAutosave } from './autosave';
import type { AutosaveTimers, SaveStatus } from './autosave';

// Fictional data only. Timers and the server are fakes the test drives by hand.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const tasks = new Map<number, { at: number; run: () => void }>();
  const timers: AutosaveTimers = {
    set(run, ms) {
      tasks.set(next, { at: now + ms, run });
      return next++;
    },
    clear: (handle) => void tasks.delete(handle as number),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function advance(ms: number) {
    now += ms;
    for (const [id, task] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
      if (task.at > now) continue;
      tasks.delete(id);
      task.run();
    }
    await settle();
  }
  return { timers, advance, settle, size: () => tasks.size };
}

function fakeServer() {
  const calls: { value: string; revision: number }[] = [];
  const replies: ((error?: Error) => void)[] = [];
  let revision = 1;
  const save = (value: string, rev: number) =>
    new Promise<{ revision: number }>((resolve, reject) => {
      calls.push({ value, revision: rev });
      replies.push((error) => (error ? reject(error) : resolve({ revision: ++revision })));
    });
  const reply = (error?: Error) => replies.shift()?.(error);
  return { calls, save, reply };
}

function setup() {
  const clock = fakeTimers();
  const server = fakeServer();
  const statuses: SaveStatus[] = [];
  const autosave = createAutosave<string>({
    save: server.save,
    revision: 1,
    timers: clock.timers,
    onStatus: (s) => statuses.push(s),
  });
  return { clock, server, statuses, autosave };
}

describe('createAutosave', () => {
  it('saves the latest change after a quiet moment', async () => {
    const { clock, server, statuses, autosave } = setup();
    autosave.change('a');
    await clock.advance(500);
    autosave.change('ab');
    await clock.advance(500);
    expect(server.calls).toEqual([]);
    await clock.advance(300);
    expect(server.calls).toEqual([{ value: 'ab', revision: 1 }]);
    expect(autosave.status).toBe('saving');
    server.reply();
    await clock.settle();
    expect(autosave).toMatchObject({ status: 'saved', revision: 2 });
    expect(statuses).toEqual(['unsaved', 'saving', 'saved']);
  });

  it('saves changes made during a save afterwards, one save at a time', async () => {
    const { clock, server, autosave } = setup();
    autosave.change('one');
    await clock.advance(800);
    autosave.change('two');
    await clock.advance(800);
    expect(server.calls.length).toBe(1);
    server.reply();
    await clock.settle();
    expect(autosave.status).toBe('unsaved');
    await clock.advance(800);
    expect(server.calls).toEqual([
      { value: 'one', revision: 1 },
      { value: 'two', revision: 2 },
    ]);
    server.reply();
    await clock.settle();
    expect(autosave).toMatchObject({ status: 'saved', revision: 3 });
  });

  it('keeps the change while offline and tries again', async () => {
    const { clock, server, autosave } = setup();
    autosave.change('draft');
    await clock.advance(800);
    server.reply(new StudioError('offline', 'No connection.'));
    await clock.settle();
    expect(autosave.status).toBe('offline');
    await clock.advance(5000);
    expect(server.calls.map((c) => c.value)).toEqual(['draft', 'draft']);
    server.reply();
    await clock.settle();
    expect(autosave.status).toBe('saved');
  });

  it('shows other failures as errors and retries them too', async () => {
    const { clock, server, autosave } = setup();
    autosave.change('draft');
    await clock.advance(800);
    server.reply(new Error('500'));
    await clock.settle();
    expect(autosave.status).toBe('error');
    expect(clock.size()).toBe(1);
  });

  it('stops on a conflict until resumed', async () => {
    const { clock, server, autosave } = setup();
    autosave.change('mine');
    await clock.advance(800);
    server.reply(new StudioError('conflict', 'Someone else saved.'));
    await clock.settle();
    expect(autosave.status).toBe('conflict');
    autosave.change('mine, edited');
    await clock.advance(10_000);
    expect(server.calls.length).toBe(1);
    autosave.resume(7);
    await clock.settle();
    expect(server.calls[1]).toEqual({ value: 'mine, edited', revision: 7 });
  });

  it('flushes now and waits for the save', async () => {
    const { clock, server, autosave } = setup();
    expect(await autosave.flush()).toBe('saved');
    autosave.change('now');
    const done = autosave.flush();
    await clock.settle();
    expect(server.calls).toEqual([{ value: 'now', revision: 1 }]);
    server.reply();
    expect(await done).toBe('saved');
    expect(clock.size()).toBe(0);
  });

  it('drops queued changes when disposed', async () => {
    const { clock, server, autosave } = setup();
    autosave.change('gone');
    autosave.dispose();
    await clock.advance(10_000);
    autosave.change('ignored');
    expect(await autosave.flush()).toBe('unsaved');
    expect(server.calls).toEqual([]);
  });
});
