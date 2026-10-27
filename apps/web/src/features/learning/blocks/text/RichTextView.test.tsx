import {
  lessonHref,
  richText,
  sampleStandardCourse,
  type ContentLesson,
  type Link,
} from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextView } from './RichTextView';

const course = sampleStandardCourse;
const lesson = course.lessons.find(
  (candidate): candidate is ContentLesson =>
    candidate.kind === 'content' && candidate.blocks.length > 0,
);
const block = lesson?.blocks[0];
if (!lesson || !block) throw new Error('The sample course needs a lesson with blocks.');

const toBlock: Link = { kind: 'lesson', lessonId: lesson.id, blockId: block.id };
const toPage: Link = { kind: 'page', pageId: 'p-team-handbook' };

describe('RichTextView', () => {
  it('shows paragraphs, line breaks, empty paragraphs and marks', () => {
    const { container } = render(
      <RichTextView
        value={richText(
          [{ text: 'Greet the caller' }, { text: ' by name', marks: ['bold'] }],
          'Line one\nLine two',
          '',
          [
            { text: 'calm', marks: ['italic', 'underline'] },
            { text: ' then press ' },
            { text: 'F2', marks: ['code'] },
            { text: ' or the old key', marks: ['strike'] },
          ],
        )}
        course={course}
        go={vi.fn()}
      />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0]).toHaveTextContent('Greet the caller by name');
    expect(container.querySelector('strong')).toHaveTextContent('by name');
    expect(paragraphs[1]?.querySelectorAll('br')).toHaveLength(1);
    expect(paragraphs[1]).toHaveTextContent('Line oneLine two');
    expect(paragraphs[2]?.innerHTML).toBe('<br>');
    expect(container.querySelector('em > u')).toHaveTextContent('calm');
    expect(container.querySelector('code')).toHaveTextContent('F2');
    expect(container.querySelector('s')).toHaveTextContent('or the old key');
  });

  it('opens https links in a new tab and mailto links in place', () => {
    render(
      <RichTextView
        value={richText([
          {
            text: 'the refund policy',
            link: { kind: 'url', url: 'https://help.example.com/refunds' },
          },
          { text: ' or ' },
          { text: 'write to the desk', link: { kind: 'url', url: 'mailto:desk@example.com' } },
        ])}
        course={course}
        go={vi.fn()}
      />,
    );
    const web = screen.getByRole('link', { name: 'the refund policy (opens in a new tab)' });
    expect(web).toHaveAttribute('href', 'https://help.example.com/refunds');
    expect(web).toHaveAttribute('target', '_blank');
    expect(web).toHaveAttribute('rel', 'noopener noreferrer');
    const mail = screen.getByRole('link', { name: 'write to the desk' });
    expect(mail).toHaveAttribute('href', 'mailto:desk@example.com');
    expect(mail).not.toHaveAttribute('target');
  });

  it('follows lesson, block and page links inside the app', () => {
    const go = vi.fn<(link: Link) => void>();
    render(
      <RichTextView
        value={richText([
          { text: 'the checklist', link: toBlock },
          { text: ' and ' },
          { text: 'the handbook', link: toPage },
        ])}
        course={course}
        go={go}
      />,
    );
    const lessonLink = screen.getByRole('link', { name: 'the checklist' });
    expect(lessonLink).toHaveAttribute('href', lessonHref(course.id, lesson.id, block.id));
    expect(fireEvent.click(lessonLink)).toBe(false);
    expect(go).toHaveBeenLastCalledWith(toBlock);

    const pageLink = screen.getByRole('link', { name: 'the handbook' });
    expect(pageLink).toHaveAttribute('href', '/p/p-team-handbook');
    fireEvent.click(pageLink);
    expect(go).toHaveBeenLastCalledWith(toPage);
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('leaves Ctrl, Cmd, Shift and middle clicks to the browser', () => {
    const go = vi.fn<(link: Link) => void>();
    render(
      <RichTextView
        value={richText([{ text: 'the checklist', link: toBlock }])}
        course={course}
        go={go}
      />,
    );
    const link = screen.getByRole('link', { name: 'the checklist' });
    // jsdom can't navigate, so stop it after the view has had its turn.
    const stay = (event: Event) => event.preventDefault();
    window.addEventListener('click', stay);
    try {
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { shiftKey: true });
      fireEvent.click(link, { button: 1 });
    } finally {
      window.removeEventListener('click', stay);
    }
    expect(go).not.toHaveBeenCalled();
  });

  it('keeps a broken link as plain text that says why', () => {
    const reason = 'This link goes to a lesson that is no longer in this course.';
    render(
      <RichTextView
        value={richText([
          { text: 'the old lesson', link: { kind: 'lesson', lessonId: 'l-removed' } },
        ])}
        course={course}
        go={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTitle(reason)).toHaveTextContent(`the old lesson (${reason})`);
  });

  it('shows nothing without text and passes classes to its wrapper', () => {
    const { container, rerender } = render(
      <RichTextView value={undefined} course={course} go={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<RichTextView value={richText('', '')} course={course} go={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <RichTextView
        value={richText('Hello')}
        course={course}
        go={vi.fn()}
        className="text-small"
      />,
    );
    expect(container.firstElementChild).toHaveClass('space-y-3', 'text-small');
  });
});
