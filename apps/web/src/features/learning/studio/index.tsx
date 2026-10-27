// Stub screens from the Learning base PR. B8 replaces them; the routes in ../routes.tsx stay as they are.

/** `/learning/studio`: the courses people build. */
export function StudioScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Studio</title>
      <h1 className="text-title text-fg">Studio</h1>
    </main>
  );
}

/** `/learning/studio/courses/:courseId`: the course editor. */
export function CourseEditorScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Edit course</title>
      <h1 className="text-title text-fg">Edit course</h1>
    </main>
  );
}

/** `/learning/studio/courses/:courseId/preview`: a draft as learners will see it. */
export function CoursePreviewScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Preview course</title>
      <h1 className="text-title text-fg">Preview course</h1>
    </main>
  );
}
