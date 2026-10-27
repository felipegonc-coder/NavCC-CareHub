import { StudioRoot } from '../context';
import { PathList } from './PathList';

/** `/learning/studio/paths`: the learning paths people build. */
export function PathsStudioScreen() {
  return (
    <StudioRoot>
      <PathList />
    </StudioRoot>
  );
}

// The path builder is still the base PR's stub; the next PR replaces it.

/** `/learning/studio/paths/:pathId`: the path builder. */
export function PathEditorScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Edit learning path</title>
      <h1 className="text-title text-fg">Edit learning path</h1>
    </main>
  );
}
