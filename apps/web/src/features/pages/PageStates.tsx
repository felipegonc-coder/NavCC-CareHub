// What a screen shows instead of a page: a problem with a way out, or grey lines while it loads.
import { buttonClasses, cn, Skeleton, VisuallyHidden } from '@carehub/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { columnClasses } from './PageHeader';
import { TopBarSkeleton } from './PageTopBar';

interface ProblemProps {
  title: string;
  text: string;
  /** What to do instead of going Home. */
  children?: ReactNode;
}

export function Problem({ title, text, children }: ProblemProps) {
  return (
    <main className="mx-auto flex w-full max-w-page flex-col items-start gap-3 px-6 py-16">
      <title>{`Care Hub · ${title}`}</title>
      <h1 className="text-title">{title}</h1>
      <p className="text-muted">{text}</p>
      {children ?? (
        <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
          Go to Home
        </Link>
      )}
    </main>
  );
}

/** The top bar and 6 grey lines, only once loading has taken 300 ms. */
export function Loading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return <main />;
  return (
    <main className={cn(columnClasses(false), 'flex flex-col gap-3 pt-24')}>
      <TopBarSkeleton />
      <VisuallyHidden role="status">Loading the page</VisuallyHidden>
      {['w-1/2', 'w-full', 'w-11/12', 'w-full', 'w-3/4', 'w-2/3'].map((width, index) => (
        <Skeleton key={index} className={cn(index === 0 ? 'mb-4 h-10' : 'h-5', width)} />
      ))}
    </main>
  );
}
