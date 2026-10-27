import type { Screen } from '../screens.js';

// The screens of the learning lane. Names start with "learning-"; see ../README.md.
export const screens: Screen[] = [
  // Studio (B8): the course list, and New course with the course types and the examples to copy.
  { name: 'learning-studio', path: '/learning/studio' },
  {
    name: 'learning-studio-new-course',
    path: '/learning/studio',
    setup: async (page) => {
      await page.getByRole('button', { name: 'New course' }).click();
      await page.getByRole('dialog', { name: 'New course' }).waitFor();
    },
  },
  // The course editor, on a copy of the first example course.
  {
    name: 'learning-studio-editor',
    path: '/learning/studio',
    setup: async (page) => {
      await page.getByRole('button', { name: 'New course' }).click();
      await page
        .getByRole('button', { name: /^Copy / })
        .first()
        .click();
      await page.getByRole('navigation', { name: 'Outline' }).waitFor();
    },
  },
  // The add-block menu, on the first lesson of that copy.
  {
    name: 'learning-studio-block-menu',
    path: '/learning/studio',
    setup: async (page) => {
      await page.getByRole('button', { name: 'New course' }).click();
      await page
        .getByRole('button', { name: /^Copy / })
        .first()
        .click();
      await page.getByRole('button', { name: 'Add block', exact: true }).click();
      await page.getByRole('menu', { name: 'Add a block' }).waitFor();
    },
  },
  // The preview of a copy of the first example course, at computer width.
  {
    name: 'learning-studio-preview',
    path: '/learning/studio',
    setup: async (page) => {
      await page.getByRole('button', { name: 'New course' }).click();
      await page
        .getByRole('button', { name: /^Copy / })
        .first()
        .click();
      await page.getByRole('link', { name: 'Preview', exact: true }).click();
      await page.getByRole('region', { name: 'Preview at computer width' }).waitFor();
    },
  },
];
