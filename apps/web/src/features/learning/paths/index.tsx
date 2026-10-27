import { IdSchema, type Id } from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useParams } from 'react-router';
import { LearningApiError } from '../data';
import { MyLearningLink, ScreenLoading, ScreenMessage } from '../player/ScreenMessage';
import { usePathPage } from './data';
import { PathView } from './PathView';

/** `/learning/paths/:pathId`: a learning path's page. */
export function PathScreen() {
  const pathId = IdSchema.safeParse(useParams().pathId);
  if (!pathId.success) return <PathNotFound />;
  return <PathLoader pathId={pathId.data} />;
}

function PathLoader({ pathId }: { pathId: Id }) {
  const page = usePathPage(pathId);
  if (page.data) return <PathView page={page.data} />;
  if (!page.error) return <ScreenLoading label="Loading the learning path" />;
  const status = page.error instanceof LearningApiError ? page.error.status : 0;
  if (status === 404) return <PathNotFound />;
  if (status === 403) {
    return (
      <ScreenMessage
        title="No access to learning paths"
        text="Learning paths aren't available for guest accounts yet."
      />
    );
  }
  return (
    <ScreenMessage
      title="This learning path didn't load"
      text={
        page.error instanceof LearningApiError
          ? page.error.message
          : 'Reload the page, then try again.'
      }
    >
      <Button onClick={() => void page.refetch()} className="max-md:h-11">
        Try again
      </Button>
    </ScreenMessage>
  );
}

/** A path that doesn't exist, or a bad link. */
function PathNotFound() {
  return (
    <ScreenMessage
      title="Learning path not found"
      text="Check the link, or find your courses in My learning."
    >
      <MyLearningLink />
    </ScreenMessage>
  );
}
