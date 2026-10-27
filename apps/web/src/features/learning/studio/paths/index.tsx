import { IdSchema } from '@carehub/learning';
import { useParams } from 'react-router';
import { LearningApiError } from '../../data';
import { StudioRoot } from '../context';
import { PathEditor, PathMissing } from './PathEditor';
import { PathList } from './PathList';

/** `/learning/studio/paths`: the learning paths people build. */
export function PathsStudioScreen() {
  return (
    <StudioRoot>
      <PathList />
    </StudioRoot>
  );
}

function EditorRoute() {
  const pathId = IdSchema.safeParse(useParams().pathId);
  // A link that can't be a path id gets "not found" without asking the server (0310).
  if (!pathId.success) {
    return <PathMissing error={new LearningApiError(404, 'not_found', 'Not found')} />;
  }
  return <PathEditor key={pathId.data} pathId={pathId.data} />;
}

/** `/learning/studio/paths/:pathId`: the path builder. */
export function PathEditorScreen() {
  return (
    <StudioRoot>
      <EditorRoute />
    </StudioRoot>
  );
}
