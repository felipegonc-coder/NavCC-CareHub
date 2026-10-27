import { richText } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextView } from './RichTextView';
import { testCourse } from './testing';

describe('RichTextView', () => {
  it('shows paragraphs with their marks', () => {
    const { container } = render(
      <RichTextView
        value={richText('First', [{ text: 'Wash ' }, { text: 'both', marks: ['bold', 'italic'] }])}
        course={testCourse}
        go={() => {}}
      />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]?.textContent).toBe('Wash both');
    expect(container.querySelector('em > strong')?.textContent).toBe('both');
  });

  it('shows nothing for empty text', () => {
    const { container } = render(
      <RichTextView value={richText('')} course={testCourse} go={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('follows lesson links inside the app and opens other sites in a new tab', () => {
    const go = vi.fn();
    const lesson = { kind: 'lesson', lessonId: 'lesson_2' } as const;
    render(
      <RichTextView
        value={richText([
          { text: 'Next lesson', link: lesson },
          { text: ' or ' },
          { text: 'the guide', link: { kind: 'url', url: 'https://example.org/guide' } },
        ])}
        course={testCourse}
        go={go}
      />,
    );
    const inside = screen.getByRole('link', { name: 'Next lesson' });
    expect(inside).toHaveAttribute('href', '/learning/courses/course_1/lessons/lesson_2');
    fireEvent.click(inside);
    expect(go).toHaveBeenCalledWith(lesson);
    const outside = screen.getByRole('link', { name: 'the guide (opens in a new tab)' });
    expect(outside).toHaveAttribute('target', '_blank');
    expect(outside).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(outside);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('shows a link to a lesson that is gone as plain text', () => {
    render(
      <RichTextView
        value={richText([{ text: 'Old lesson', link: { kind: 'lesson', lessonId: 'lesson_9' } }])}
        course={testCourse}
        go={() => {}}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Old lesson')).toBeInTheDocument();
  });
});
