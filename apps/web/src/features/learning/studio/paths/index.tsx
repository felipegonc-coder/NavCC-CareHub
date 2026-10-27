// Stub screens from the Learning base PR. B3 replaces them; the routes in ../../routes.tsx stay as they are.

/** `/learning/studio/paths`: the learning paths people build. */
export function PathsStudioScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Learning paths</title>
      <h1 className="text-title text-fg">Learning paths</h1>
    </main>
  );
}

/** `/learning/studio/paths/:pathId`: the path builder. */
export function PathEditorScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Edit learning path</title>
      <h1 className="text-title text-fg">Edit learning path</h1>
    </main>
  );
}
