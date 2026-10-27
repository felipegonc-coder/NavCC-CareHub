import type { FastifyPluginAsync } from 'fastify';
import { registerFileScope } from './files';
import filesStandIn, { filesStandInAllowed, type FilesStandInOptions } from './files-routes';

/** Who may see and change a course (from the courses area). */
export type CourseAccess = {
  canSeeCourse(userId: string, courseId: string): Promise<boolean>;
  canEditCourse(userId: string, courseId: string): Promise<boolean>;
};

export type MediaRoutesOptions = { courses?: CourseAccess; files?: FilesStandInOptions };

const NOBODY: CourseAccess = {
  canSeeCourse: async () => false,
  canEditCourse: async () => false,
};

/**
 * Learning media on the server. Course files are scoped `learning:<courseId>`: anyone who can see the course may
 * read them, and people who can edit it (learning.build) may add and delete them. Without `courses`, nobody can.
 */
const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (app, options) => {
  const courses = options.courses ?? NOBODY;
  registerFileScope('learning', {
    canRead: (user, courseId) => courses.canSeeCourse(user.id, courseId),
    canWrite: (user, courseId) => courses.canEditCourse(user.id, courseId),
  });
  // Until core's files API lands (Oct 28), and never in production.
  if (filesStandInAllowed())
    await app.register(filesStandIn, { ...options.files, prefix: '/files' });
};

export default mediaRoutes;
