// Stub screens from the Learning base PR. B4 replaces them; the routes in ../routes.tsx stay as they are.

/** `/learning/reports`: the reports overview. */
export function ReportsScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Reports</title>
      <h1 className="text-title text-fg">Reports</h1>
    </main>
  );
}

/** `/learning/reports/courses/:courseId`: one course's report. */
export function CourseReportScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Course report</title>
      <h1 className="text-title text-fg">Course report</h1>
    </main>
  );
}

/** `/learning/reports/overdue`: overdue learning. */
export function OverdueReportScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Overdue</title>
      <h1 className="text-title text-fg">Overdue</h1>
    </main>
  );
}
