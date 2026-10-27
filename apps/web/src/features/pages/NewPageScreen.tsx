// "New page" (Sidebar spec, section 2) at /new: makes an untitled page at the top of the person's
// Private section and opens it, with the cursor in the title and an "Add to" picker at the top.
import { pageUrl } from '@carehub/shared';
import { Button } from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { refreshPageData } from './actions';
import { createPage, fetchSpaces, pagesKeys } from './api';
import { Loading, Problem } from './PageStates';

/** The location state the page screen gets from "New page". */
export const NEW_PAGE_STATE = { focusTitle: true, addTo: true } as const;

export function NewPageScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const spaces = useQuery({ queryKey: pagesKeys.spaces, queryFn: fetchSpaces });
  const privateId = spaces.data?.find((space) => space.kind === 'personal')?.id;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<unknown>(null);
  // One page per try, even when React runs the effect twice; no jump once the person has left.
  const made = useRef(-1);
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  useEffect(() => {
    if (!privateId || made.current === attempt) return;
    made.current = attempt;
    createPage({ spaceId: privateId }).then(
      (page) => {
        void refreshPageData(queryClient);
        if (shown.current)
          void navigate(pageUrl(page.id), { replace: true, state: NEW_PAGE_STATE });
      },
      (reason: unknown) => setError(reason ?? new Error('failed')),
    );
  }, [attempt, navigate, privateId, queryClient]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <Problem
        title="Can't add pages"
        text="Your role doesn't let you add pages. An Admin can change that."
      />
    );
  }
  if (error || spaces.isError || (spaces.data && !privateId)) {
    const retry = () => {
      if (!privateId) {
        void spaces.refetch();
        return;
      }
      setError(null);
      setAttempt((count) => count + 1);
    };
    return (
      <Problem title="Couldn't add the page" text="Something went wrong on our side.">
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </Problem>
    );
  }
  return <Loading />;
}
