import { DEFAULT_ACKNOWLEDGEMENT, LIMITS } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioClient } from '../data/client';
import { renderEditor } from '../test-utils';

// Fictional data only.
const SAVE_WAIT = { timeout: 3000 };

const withLesson = (blank: Course): Course => ({
  ...blank,
  lessons: [{ id: 'lesson-why', kind: 'content', title: 'Why it matters', blocks: [] }],
});

/** Opens "Hand hygiene" in the editor and its settings from the outline. */
async function openSettings() {
  const view = await renderEditor(withLesson);
  fireEvent.click(screen.getByRole('button', { name: 'Course settings' }));
  return { ...view, settings: screen.getByRole('region', { name: 'Course settings' }) };
}

/** Waits until the saved draft passes `check`. */
const savedDraft = (client: StudioClient, courseId: string, check: (course: Course) => void) =>
  waitFor(async () => check((await client.getCourse(courseId)).course), SAVE_WAIT);

const box = (scope: HTMLElement, name: string) => within(scope).getByRole('textbox', { name });
const numberBox = (scope: HTMLElement, name: string) =>
  within(scope).getByRole('spinbutton', { name });
const checkbox = (scope: HTMLElement, name: string) =>
  within(scope).getByRole('checkbox', { name });

describe('course settings', () => {
  it('open from the outline with the focus on them, and save the summary', async () => {
    const { client, courseId, settings } = await openSettings();
    await waitFor(() => expect(settings).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Course settings' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.change(box(settings, 'Summary'), {
      target: { value: 'Why and when to clean your hands.' },
    });
    await savedDraft(client, courseId, (course) =>
      expect(course.summary).toBe('Why and when to clean your hands.'),
    );
  });

  it('take whole minutes only, and an empty box means not set', async () => {
    const { client, courseId, settings } = await openSettings();
    const minutes = numberBox(settings, 'Estimated time in minutes');
    fireEvent.change(minutes, { target: { value: '1.5' } });
    expect(
      within(settings).getByText(`Use a whole number from 1 to ${LIMITS.estimatedMinutes}.`),
    ).toBeInTheDocument();
    fireEvent.change(minutes, { target: { value: '15' } });
    expect(within(settings).queryByText(/Use a whole number/)).toBeNull();
    await savedDraft(client, courseId, (course) => expect(course.estimatedMinutes).toBe(15));
    fireEvent.change(minutes, { target: { value: '' } });
    await savedDraft(client, courseId, (course) =>
      expect(course).not.toHaveProperty('estimatedMinutes'),
    );
  });

  it('take a cover picture by https address, with a description', async () => {
    const { client, courseId, settings } = await openSettings();
    const address = box(settings, 'Cover picture address');
    fireEvent.change(address, { target: { value: 'http://example.com/hands.jpg' } });
    expect(within(settings).getByText('Use a full https:// address.')).toBeInTheDocument();
    expect(
      within(settings).queryByRole('textbox', { name: 'Describe the cover picture' }),
    ).toBeNull();
    fireEvent.change(address, { target: { value: 'https://example.com/hands.jpg' } });
    fireEvent.change(box(settings, 'Describe the cover picture'), {
      target: { value: 'Hands under a tap' },
    });
    await savedDraft(client, courseId, (course) =>
      expect(course.cover).toEqual({
        alt: 'Hands under a tap',
        media: { kind: 'url', url: 'https://example.com/hands.jpg' },
      }),
    );
  });

  it('change the completion rules, asking for the statement to sign', async () => {
    const { client, courseId, settings } = await openSettings();
    const inOrder = checkbox(settings, 'Lessons are taken in order');
    expect(inOrder).not.toBeChecked();
    fireEvent.click(inOrder);
    expect(inOrder).toBeChecked();
    expect(
      within(settings).getByText('Add a quiz to the course for this to count.'),
    ).toBeInTheDocument();

    expect(
      within(settings).queryByRole('textbox', { name: 'Acknowledgement statement' }),
    ).toBeNull();
    fireEvent.click(checkbox(settings, 'Sign an acknowledgement to complete the course'));
    fireEvent.change(box(settings, 'Acknowledgement statement'), {
      target: { value: 'I will clean my hands at the five moments.' },
    });
    fireEvent.change(numberBox(settings, 'Minimum time in the course, in minutes'), {
      target: { value: '10' },
    });
    await savedDraft(client, courseId, ({ settings: saved }) => {
      expect(saved.lessonOrder).toBe('sequential');
      expect(saved.completion.requireAcknowledgement).toBe(true);
      expect(saved.acknowledgement?.statement).toBe('I will clean my hands at the five moments.');
      expect(saved.minimumCourseSeconds).toBe(600);
    });
  });

  it('hide the course from the catalog and give a certificate for some months', async () => {
    const { client, courseId, settings } = await openSettings();
    fireEvent.click(checkbox(settings, 'Show in the catalog'));
    expect(
      within(settings).queryByRole('textbox', { name: 'Certificate valid for, in months' }),
    ).toBeNull();
    fireEvent.click(checkbox(settings, 'Give a certificate'));
    fireEvent.change(numberBox(settings, 'Certificate valid for, in months'), {
      target: { value: '24' },
    });
    await savedDraft(client, courseId, ({ settings: saved }) => {
      expect(saved.catalog.listed).toBe(false);
      expect(saved.certificate).toEqual({ enabled: true, validForMonths: 24 });
    });
  });

  it('apply a course type with its settings, and Undo puts mine back', async () => {
    const { settings } = await openSettings();
    const type = within(settings).getByRole('group', { name: 'Type' });
    expect(within(type).getByRole('radio', { name: 'Standard' })).toBeChecked();
    const requiredRead = within(type).getByRole('radio', { name: 'Required read' });
    expect(requiredRead).toHaveAccessibleDescription(/an "I have read and understood" sign-off/);
    fireEvent.click(requiredRead);
    expect(requiredRead).toBeChecked();
    expect(checkbox(settings, 'Lessons are taken in order')).toBeChecked();
    expect(checkbox(settings, 'Sign an acknowledgement to complete the course')).toBeChecked();
    expect(box(settings, 'Acknowledgement statement')).toHaveValue(DEFAULT_ACKNOWLEDGEMENT);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(type).getByRole('radio', { name: 'Standard' })).toBeChecked();
    expect(checkbox(settings, 'Lessons are taken in order')).not.toBeChecked();
    expect(
      within(settings).queryByRole('textbox', { name: 'Acknowledgement statement' }),
    ).toBeNull();
  });

  it('close when a lesson is chosen in the outline', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('link', { name: '1. Why it matters' }));
    expect(screen.queryByRole('region', { name: 'Course settings' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Lesson title' })).toHaveValue('Why it matters');
    expect(screen.getByRole('button', { name: 'Course settings' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
