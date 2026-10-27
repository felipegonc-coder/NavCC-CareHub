import { LoadFailed, ScreenLoading } from '../player/ScreenMessage';
import { useMyLearning } from './data';
import { MyLearning } from './MyLearning';

/** `/learning`: the learner's courses (overdue, in progress, assigned, finished), then more. */
export function MyLearningScreen() {
  const mine = useMyLearning();
  if (!mine.data) {
    if (!mine.error) return <ScreenLoading label="Loading My learning" />;
    return <LoadFailed error={mine.error} what="page" retry={() => void mine.refetch()} />;
  }
  return <MyLearning learning={mine.data} />;
}
