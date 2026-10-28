import { type ButtonBlock, type ButtonTarget } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { ButtonView } from './ButtonView';

const button = (target: ButtonTarget, label = 'Next lesson'): ButtonBlock => ({
  id: 'btn_1',
  type: 'button',
  label,
  description: 'When you are ready:',
  target,
});

describe('ButtonView', () => {
  it('opens a lesson inside Care Hub, unless a new tab is asked for', () => {
    const props = viewProps(button({ kind: 'lesson', lessonId: 'lesson_2' }));
    render(<ButtonView {...props} />);
    expect(screen.getByText('When you are ready:')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Next lesson' });
    expect(link).toHaveAttribute('href', '/learning/courses/course_1/lessons/lesson_2');
    fireEvent.click(link, { ctrlKey: true });
    expect(props.go).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(props.go).toHaveBeenCalledWith({ kind: 'lesson', lessonId: 'lesson_2' });
  });

  it('opens web pages and files in a new tab', () => {
    const { rerender } = render(
      <ButtonView
        {...viewProps(button({ kind: 'url', url: 'https://example.org/rota' }, 'Rota'))}
      />,
    );
    const page = screen.getByRole('link', { name: 'Rota (opens in a new tab)' });
    expect(page).toHaveAttribute('target', '_blank');
    expect(page).toHaveAttribute('rel', 'noopener noreferrer');
    rerender(
      <ButtonView {...viewProps(button({ kind: 'file', fileId: 'file_9' }, 'Checklist'))} />,
    );
    expect(screen.getByRole('link', { name: 'Checklist (opens in a new tab)' })).toHaveAttribute(
      'href',
      '/api/files/file_9',
    );
  });

  it('is turned off, with the reason, when its lesson is gone', () => {
    render(<ButtonView {...viewProps(button({ kind: 'lesson', lessonId: 'lesson_9' }))} />);
    expect(screen.getByRole('button', { name: 'Next lesson' })).toBeDisabled();
    expect(
      screen.getByText('This link goes to a lesson that is no longer in this course.'),
    ).toBeInTheDocument();
  });
});
