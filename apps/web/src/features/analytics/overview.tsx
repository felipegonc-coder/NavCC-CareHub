import { pageUrl } from '@carehub/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@carehub/ui';
import { Link } from 'react-router';
import type { Overview, TopEditor, TopPage } from './api';
import { DataTable, type Column } from './data-table';
import { DayChart, type Series } from './day-chart';
import { countText, pageName } from './format';

const TOTALS = [
  { key: 'activePeople', label: 'Active people' },
  { key: 'views', label: 'Page views' },
  { key: 'edits', label: 'Edits' },
  { key: 'created', label: 'Pages created' },
] as const;

const ACTIVE: Series = {
  key: 'activePeople',
  label: 'Active people',
  one: 'active person',
  many: 'active people',
  tone: 'text-fg',
};
const VIEWS: Series = {
  key: 'views',
  label: 'Page views',
  one: 'view',
  many: 'views',
  tone: 'text-fg',
};
const EDITS: Series = {
  key: 'edits',
  label: 'Edits',
  one: 'edit',
  many: 'edits',
  tone: 'text-muted',
};

const PAGE_COLUMNS: Column<TopPage>[] = [
  {
    key: 'page',
    label: 'Page',
    value: pageName,
    // Pages in the Trash or deleted for good keep their numbers, without a link.
    render: (page) =>
      page.state === 'trash' || page.state === 'deleted' ? (
        pageName(page)
      ) : (
        <Link to={pageUrl(page.pageId)} className="underline-offset-2 hover:underline">
          {pageName(page)}
        </Link>
      ),
  },
  { key: 'views', label: 'Views', value: (page) => page.views, numeric: true },
  { key: 'viewers', label: 'People who viewed', value: (page) => page.viewers, numeric: true },
];

const EDITOR_COLUMNS: Column<TopEditor>[] = [
  { key: 'name', label: 'Person', value: (editor) => editor.name },
  { key: 'edits', label: 'Edits', value: (editor) => editor.edits, numeric: true },
];

const isEmpty = ({ totals }: Overview) =>
  totals.activePeople + totals.views + totals.edits + totals.created === 0;

/** Overview's numbers, charts and top 10 lists (Analytics spec, section 2; AN-04). */
export function OverviewNumbers({ overview }: { overview: Overview }) {
  const { range, totals, days, topPages, topEditors } = overview;
  if (isEmpty(overview)) {
    return (
      <Card data-testid="analytics-empty">
        <p>No activity in this range.</p>
      </Card>
    );
  }
  const file = (name: string) => `analytics-${name}-${range.from}-to-${range.to}`;
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 md:grid-cols-4" data-testid="analytics-totals">
        {TOTALS.map(({ key, label }) => (
          <Card key={key} className="flex flex-col gap-1" data-testid={`analytics-total-${key}`}>
            <dt className="text-small text-muted">{label}</dt>
            <dd className="text-title tabular-nums">{countText(totals[key])}</dd>
          </Card>
        ))}
      </dl>
      <DayChart
        title="Active people per day"
        kind="line"
        series={[ACTIVE]}
        days={days}
        fileName={file('active-people')}
        testId="analytics-chart-active-people"
      />
      <DayChart
        title="Views and edits per day"
        kind="bar"
        series={[VIEWS, EDITS]}
        days={days}
        fileName={file('views-and-edits')}
        testId="analytics-chart-views-edits"
      />
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <CardHeader>
            <CardTitle as="h2">Top pages</CardTitle>
            <CardDescription>The 10 pages with the most views.</CardDescription>
          </CardHeader>
          {topPages.length > 0 ? (
            <DataTable
              caption="Top pages"
              columns={PAGE_COLUMNS}
              rows={topPages}
              rowKey={(page) => page.pageId}
              sortedBy={{ key: 'views', direction: 'descending' }}
              fileName={file('top-pages')}
              testId="analytics-top-pages"
            />
          ) : (
            <p className="text-small text-muted">No page views in this range.</p>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardHeader>
            <CardTitle as="h2">Top editors</CardTitle>
            <CardDescription>The 10 people with the most edits.</CardDescription>
          </CardHeader>
          {topEditors.length > 0 ? (
            <DataTable
              caption="Top editors"
              columns={EDITOR_COLUMNS}
              rows={topEditors}
              rowKey={(editor) => editor.userId}
              sortedBy={{ key: 'edits', direction: 'descending' }}
              fileName={file('top-editors')}
              testId="analytics-top-editors"
            />
          ) : (
            <p className="text-small text-muted">No edits in this range.</p>
          )}
        </Card>
      </div>
    </>
  );
}
