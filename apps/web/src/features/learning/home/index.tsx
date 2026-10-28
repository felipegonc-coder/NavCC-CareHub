import { useProfileTimeZone } from '../data/timeZone';
import { LoadFailed, ScreenLoading } from '../player/ScreenMessage';
import { useMyLearning } from './data';
import { MyLearning } from './MyLearning';

/** `/learning`: the learner's courses (overdue, in progress, assigned, finished), then more. */
export function MyLearningScreen() {
  const mine = useMyLearning();
  // The days on the page are in the profile's time zone (0317), so the page waits for it too.
  const timeZone = useProfileTimeZone();
  if (!mine.data || !timeZone) {
    if (!mine.error) return <ScreenLoading label="Loading My learning" />;
    return <LoadFailed error={mine.error} what="page" retry={() => void mine.refetch()} />;
  }
  return <MyLearning learning={mine.data} timeZone={timeZone} />;
}
