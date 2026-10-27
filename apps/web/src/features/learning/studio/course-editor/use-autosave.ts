import { useQueryClient } from '@tanstack/react-query';
import type { Course, Id } from '@carehub/learning';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioClient } from '../context';
import { createAutosave } from '../data/autosave';
import type { Autosave, SaveStatus } from '../data/autosave';
import { studioKeys } from '../data/queries';

/** The open draft's saving: where it stands, and the two ways out of a conflict. */
export type DraftSaving = {
  status: SaveStatus;
  /** After a conflict: save this version over the newer one. */
  keepMine(): Promise<void>;
  /**
   * Fetches the saved draft to load in the editor and carries on saving from it: after a conflict (this
   * version's changes are dropped) or a roll back.
   */
  reload(): Promise<Course>;
  /** Saves any change still waiting, now. Resolves to where the draft stands afterwards. */
  flush(): Promise<SaveStatus>;
};

/**
 * Saves `course`, the editor's present draft, a moment after each change, starting from `revision`. Saves
 * what's left when the editor closes or the page is hidden.
 */
export function useDraftAutosave(courseId: Id, revision: number, course: Course): DraftSaving {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [base, setBase] = useState(revision);
  const saver = useRef<Autosave<Course> | null>(null);
  const queued = useRef(course);

  useEffect(() => {
    const autosave = createAutosave<Course>({
      revision: base,
      save: async (value, at) => {
        const saved = await client.saveCourse(courseId, value, at);
        // The course list shows titles and "Edited" dates; refresh it after each save.
        void queryClient.invalidateQueries({ queryKey: studioKeys.courseLists });
        return saved;
      },
      onStatus: setStatus,
    });
    saver.current = autosave;
    const flush = () => void autosave.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      saver.current = null;
      void autosave.flush().finally(() => autosave.dispose());
    };
  }, [client, courseId, base, queryClient]);

  useEffect(() => {
    if (course === queued.current) return;
    queued.current = course;
    saver.current?.change(course);
  }, [course]);

  const keepMine = useCallback(async () => {
    const latest = await client.getCourse(courseId);
    saver.current?.resume(latest.revision);
  }, [client, courseId]);

  const reload = useCallback(async () => {
    const latest = await client.getCourse(courseId);
    queued.current = latest.course;
    setStatus('saved');
    setBase(latest.revision);
    return latest.course;
  }, [client, courseId]);

  const flush = useCallback(
    async (): Promise<SaveStatus> => (saver.current ? saver.current.flush() : 'saved'),
    [],
  );

  return { status, keepMine, reload, flush };
}
