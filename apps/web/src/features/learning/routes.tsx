import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';

/** A Learning screen: its path under the app and how to load it (only when someone opens it). */
export type LearningScreen = { path: string; load: () => Promise<ComponentType> };

// Every Learning screen (docs/learning/PLAN.md). Each one lives in its owner's folder (index.tsx), so owners build
// their screens without editing this list.
export const screens: readonly LearningScreen[] = [
  { path: 'learning', load: async () => (await import('./home/index')).MyLearningScreen },
  { path: 'learning/catalog', load: async () => (await import('./catalog/index')).CatalogScreen },
  {
    path: 'learning/courses/:courseId',
    load: async () => (await import('./course/index')).CourseStartScreen,
  },
  {
    path: 'learning/courses/:courseId/lessons/:lessonId',
    load: async () => (await import('./player/index')).PlayerScreen,
  },
  { path: 'learning/paths/:pathId', load: async () => (await import('./paths/index')).PathScreen },
  {
    path: 'learning/certificates',
    load: async () => (await import('./certificates/index')).CertificatesScreen,
  },
  {
    path: 'learning/certificates/:certificateId',
    load: async () => (await import('./certificates/index')).CertificateScreen,
  },
  { path: 'learning/studio', load: async () => (await import('./studio/index')).StudioScreen },
  {
    path: 'learning/studio/courses/:courseId',
    load: async () => (await import('./studio/index')).CourseEditorScreen,
  },
  {
    path: 'learning/studio/courses/:courseId/preview',
    load: async () => (await import('./studio/index')).CoursePreviewScreen,
  },
  {
    path: 'learning/studio/paths',
    load: async () => (await import('./studio/paths/index')).PathsStudioScreen,
  },
  {
    path: 'learning/studio/paths/:pathId',
    load: async () => (await import('./studio/paths/index')).PathEditorScreen,
  },
  {
    path: 'learning/studio/banks',
    load: async () => (await import('./studio/banks/index')).BanksScreen,
  },
  {
    path: 'learning/studio/banks/:bankId',
    load: async () => (await import('./studio/banks/index')).BankEditorScreen,
  },
  { path: 'learning/assign', load: async () => (await import('./assign/index')).AssignScreen },
  { path: 'learning/reports', load: async () => (await import('./reports/index')).ReportsScreen },
  {
    path: 'learning/reports/courses/:courseId',
    load: async () => (await import('./reports/index')).CourseReportScreen,
  },
  {
    path: 'learning/reports/overdue',
    load: async () => (await import('./reports/index')).OverdueReportScreen,
  },
  {
    path: 'learning/reports/people/:personId',
    load: async () => (await import('./reports/people/index')).PersonReportScreen,
  },
  {
    path: 'learning/reports/team',
    load: async () => (await import('./reports/team/index')).TeamReportScreen,
  },
  {
    path: 'learning/reports/paths/:pathId',
    load: async () => (await import('./reports/paths/index')).PathReportScreen,
  },
  {
    path: 'learning/review',
    load: async () => (await import('./review/index')).ReviewScreen,
  },
];

/** Spread into the app's routes by apps/web/src/routes.tsx (0007 section 5.1). */
export const routes: RouteObject[] = screens.map(({ path, load }) => ({
  path,
  lazy: async () => ({ Component: await load() }),
}));
