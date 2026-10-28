import { createCourse, newKnowledgeCheck } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeCheckEditor, questionEditors } from './index';

// Fictional content only.
describe('KnowledgeCheckEditor', () => {
  it('edits the question without points, and whether people can try again', () => {
    let n = 0;
    const block = newKnowledgeCheck('true_false', () => `kc${++n}`);
    const onChange = vi.fn();
    const course = createCourse({ type: 'standard', title: 'Refunds basics' });
    render(
      <KnowledgeCheckEditor block={block} onChange={onChange} course={course} lessonId="l1" />,
    );
    expect(screen.queryByRole('spinbutton', { name: 'Points' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Let people try again' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...block, allowRetry: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'The statement is true' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...block,
      question: { ...block.question, answer: false },
    });
  });

  it('is the knowledge check editor in the questions family', () => {
    expect(questionEditors.knowledge_check).toBe(KnowledgeCheckEditor);
  });
});
