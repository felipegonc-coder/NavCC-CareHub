import {
  CourseSchema,
  checkPublishable,
  createCourse,
  duplicateCourse,
  newId as randomId,
  parseCourse,
  sampleCourses,
} from '@carehub/learning';
import type { Course, Id } from '@carehub/learning';
import { StudioError } from './client';
import type { BlockTemplate, StudioClient, StudioCourseSummary, StudioDraft } from './client';

// A stand-in for the Studio course API (api.md) that keeps everything in the browser, used until the server
// lands and in tests. It behaves like the server: a revision check on save, publish checks, versions and roll
// back (a new version copying an old one), and copies that start unpublished.

type Version = { version: number; publishedAt: string; note?: string; course: Course };
type Entry = {
  draft: Course;
  revision: number;
  updatedAt: string;
  archived: boolean;
  versions: Version[];
};
type Store = { courses: Record<Id, Entry>; templates: BlockTemplate[] };

/** Options for {@link createMemoryStudioClient}. */
export type MemoryStudioOptions = {
  /** Keeps drafts across reloads (e.g. `window.localStorage`); without it they live in memory only. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Defaults to "carehub.learning.studio". */
  storageKey?: string;
  /** Courses offered as examples to start from. Defaults to the package's sample courses. */
  examples?: readonly Course[];
  now?: () => Date;
  newId?: () => Id;
};

const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new StudioError('not_found', 'This was deleted, or the link is wrong.');

function load(storage: MemoryStudioOptions['storage'], key: string): Store {
  const store: Store = { courses: {}, templates: [] };
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null') as Partial<Store> | null;
    for (const [id, entry] of Object.entries(saved?.courses ?? {})) {
      const draft = parseCourse(entry.draft);
      if (draft.ok) store.courses[id] = { ...entry, draft: draft.course };
    }
    if (Array.isArray(saved?.templates)) store.templates = saved.templates;
  } catch {
    // Unreadable storage: start empty.
  }
  return store;
}

/** A StudioClient keeping courses and block templates in memory, and in `storage` when given. */
export function createMemoryStudioClient(options: MemoryStudioOptions = {}): StudioClient {
  const { storage, storageKey = 'carehub.learning.studio', examples = sampleCourses } = options;
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const newId = options.newId ?? randomId;
  const store = load(storage, storageKey);
  const persist = () => storage?.setItem(storageKey, JSON.stringify(store));

  const entry = (courseId: Id): Entry => {
    const found = store.courses[courseId];
    if (!found) throw notFound();
    return found;
  };
  const draftOf = (e: Entry): StudioDraft => ({
    course: copy(e.draft),
    revision: e.revision,
    liveVersion: e.versions.at(-1)?.version ?? null,
  });
  const summary = (e: Entry): StudioCourseSummary => {
    const live = e.versions.at(-1);
    const same = live !== undefined && JSON.stringify(live.course) === JSON.stringify(e.draft);
    return {
      id: e.draft.id,
      title: e.draft.title,
      type: e.draft.type,
      state: live === undefined ? 'draft' : same ? 'live' : 'changed',
      version: live?.version ?? null,
      updatedAt: e.updatedAt,
      archived: e.archived,
      listed: e.draft.settings.catalog.listed,
    };
  };
  const add = (course: Course): Entry => {
    const e: Entry = {
      draft: course,
      revision: 1,
      updatedAt: now(),
      archived: false,
      versions: [],
    };
    store.courses[course.id] = e;
    persist();
    return e;
  };
  const publishCopy = (e: Entry, course: Course, note?: string): { version: number } => {
    const version = (e.versions.at(-1)?.version ?? 0) + 1;
    e.versions.push({
      version,
      publishedAt: now(),
      ...(note ? { note } : {}),
      course: copy(course),
    });
    persist();
    return { version };
  };
  const setArchived = (courseId: Id, archived: boolean): StudioCourseSummary => {
    const e = entry(courseId);
    e.archived = archived;
    persist();
    return summary(e);
  };

  return {
    async listCourses({ archived = false } = {}) {
      return Object.values(store.courses)
        .filter((e) => e.archived === archived)
        .map(summary)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createCourse({ type, title, exampleId }) {
      if (exampleId === undefined)
        return draftOf(add(createCourse({ type, title: title ?? '', id: newId() })));
      const example = examples.find((c) => c.id === exampleId);
      if (!example) throw new StudioError('not_found', 'This example is no longer available.');
      const course = duplicateCourse(example, newId);
      return draftOf(add({ ...course, title: title?.trim() || example.title }));
    },
    async getCourse(courseId) {
      return draftOf(entry(courseId));
    },
    async saveCourse(courseId, course, revision) {
      const e = entry(courseId);
      if (revision !== e.revision)
        throw new StudioError('conflict', 'Someone else saved this course since you opened it.');
      if (course.id !== courseId || !CourseSchema.safeParse(course).success)
        throw new StudioError('invalid', "This draft can't be saved as it is.");
      Object.assign(e, { draft: copy(course), revision: e.revision + 1, updatedAt: now() });
      persist();
      return { revision: e.revision };
    },
    async publish(courseId, { note }) {
      const e = entry(courseId);
      const problems = checkPublishable(e.draft);
      if (problems.length > 0)
        throw new StudioError(
          'cannot_publish',
          "This can't be published yet. Fix the problems listed first.",
          problems,
        );
      return publishCopy(e, e.draft, note?.trim());
    },
    async listVersions(courseId) {
      return entry(courseId)
        .versions.map(({ version, publishedAt, note, course }) => ({
          version,
          publishedAt,
          title: course.title,
          ...(note ? { note } : {}),
        }))
        .reverse();
    },
    async rollback(courseId, version) {
      const e = entry(courseId);
      const old = e.versions.find((v) => v.version === version);
      if (!old) throw new StudioError('not_found', 'That version no longer exists.');
      Object.assign(e, { draft: copy(old.course), revision: e.revision + 1, updatedAt: now() });
      return publishCopy(e, old.course, `Rolled back to version ${version}`);
    },
    async duplicate(courseId) {
      return summary(add(duplicateCourse(entry(courseId).draft, newId)));
    },
    async archive(courseId) {
      return setArchived(courseId, true);
    },
    async unarchive(courseId) {
      return setArchived(courseId, false);
    },
    async listExamples() {
      return examples.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        summary: c.summary ?? '',
      }));
    },
    async listBlockTemplates() {
      return copy(store.templates);
    },
    async saveBlockTemplate({ name, blocks }) {
      const title = name.trim().slice(0, 80);
      if (title === '' || blocks.length === 0)
        throw new StudioError('invalid', 'Name the template and pick at least one block.');
      const template: BlockTemplate = { id: newId(), name: title, blocks: copy(blocks) };
      store.templates.push(template);
      persist();
      return copy(template);
    },
    async deleteBlockTemplate(templateId) {
      const at = store.templates.findIndex((t) => t.id === templateId);
      if (at < 0) throw new StudioError('not_found', 'This template was already deleted.');
      store.templates.splice(at, 1);
      persist();
    },
  };
}
