import { sampleCourses } from '@carehub/learning';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../db';
import { getCourseVersion, getLiveCourse } from '../courses/service';
import { bindCourseVersions, courseVersions, type CourseVersions } from './courses';
import { runVersion } from './run-version';
import { runVersion as progressRunVersion } from './service';

// Progress reads course versions from the courses server (B1), and GET /courses/:id reads the
// learner's run version from progress (decision 0311).

vi.mock('../courses/service', () => ({ getLiveCourse: vi.fn(), getCourseVersion: vi.fn() }));

const db = {} as Db;
const [course] = sampleCourses;

afterEach(() => bindCourseVersions(null));

describe('courseVersions', () => {
  it('reads the live version and published versions from the courses server', async () => {
    if (!course) throw new Error('Expected a sample course.');
    vi.mocked(getLiveCourse).mockResolvedValue({ course, version: 3 });
    vi.mocked(getCourseVersion).mockImplementation(async (_db, _workspaceId, _courseId, version) =>
      version === 2 ? course : null,
    );
    const versions = courseVersions();
    expect(await versions.live(db, 'workspace-1', course.id)).toEqual({ course, version: 3 });
    expect(getLiveCourse).toHaveBeenCalledWith(db, 'workspace-1', course.id);
    expect(await versions.version(db, 'workspace-1', course.id, 2)).toEqual({ course, version: 2 });
    expect(await versions.version(db, 'workspace-1', course.id, 9)).toBeNull();
  });

  it('uses versions bound by tests until they are unbound', () => {
    const none: CourseVersions = { live: async () => null, version: async () => null };
    bindCourseVersions(none);
    expect(courseVersions()).toBe(none);
    bindCourseVersions(null);
    expect(courseVersions()).not.toBe(none);
  });
});

describe('runVersion', () => {
  it("is progress's own, so GET /courses/:id opens the learner's run version", () => {
    expect(runVersion).toBe(progressRunVersion);
  });
});
