import {
  LIMITS,
  addBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveBlockBy,
  renameLesson,
  updateBlock,
  updateLessonDetails,
} from '@carehub/learning';
import type { Block, Course, Lesson } from '@carehub/learning';
import { Button, cn, IconButton } from '@carehub/ui';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BlockEditorFor } from '../editors/registry';
import { blockLabel } from '../labels';
import { BlockPicker } from './BlockPicker';
import { NumberField, TitleField } from './parts';
import { SortableList, useSortableItem } from './sortable';
import type { EditorActions } from './types';

type BlockCardProps = Pick<EditorActions, 'edit' | 'remove'> & {
  course: Course;
  lessonId: string;
  block: Block;
  index: number;
  count: number;
  /** Just added: take focus. */
  focused: boolean;
  onAddBelow(): void;
};

function BlockCard({
  course,
  lessonId,
  block,
  index,
  count,
  focused,
  edit,
  remove,
  onAddBelow,
}: BlockCardProps) {
  const name = `block ${index + 1}`;
  const item = useSortableItem(block.id, `Reorder ${name}`);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) card.current?.focus();
  }, [focused]);
  return (
    <li ref={item.ref} style={item.style} className={cn(item.dragging && 'relative z-10')}>
      <section
        ref={card}
        tabIndex={-1}
        aria-label={`Block ${index + 1}, ${blockLabel(block)}`}
        className={cn('rounded border border-border bg-bg', item.dragging && 'shadow-dialog')}
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          {item.handle}
          <span className="min-w-0 flex-1 truncate text-small font-medium text-muted">
            {blockLabel(block)}
          </span>
          <IconButton
            size="sm"
            label={`Move ${name} up`}
            aria-disabled={index === 0}
            className="aria-disabled:text-faint"
            onClick={() => edit((c) => moveBlockBy(c, block.id, -1))}
          >
            <ArrowUp aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Move ${name} down`}
            aria-disabled={index === count - 1}
            className="aria-disabled:text-faint"
            onClick={() => edit((c) => moveBlockBy(c, block.id, 1))}
          >
            <ArrowDown aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Duplicate ${name}`}
            onClick={() => edit((c) => duplicateBlock(c, block.id))}
          >
            <Copy aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Delete ${name}`}
            onClick={() =>
              remove(`Deleted ${name} (${blockLabel(block)}).`, (c) => deleteBlock(c, block.id))
            }
          >
            <Trash2 aria-hidden />
          </IconButton>
          <IconButton size="sm" label={`Add a block below ${name}`} onClick={onAddBelow}>
            <Plus aria-hidden />
          </IconButton>
        </div>
        <div className="p-3">
          <BlockEditorFor
            block={block}
            course={course}
            lessonId={lessonId}
            onChange={(next) =>
              edit((c) => updateBlock(c, block.id, () => next), { group: `block:${block.id}` })
            }
          />
        </div>
      </section>
    </li>
  );
}

/** The selected lesson: its title and blocks, each with move, duplicate, delete and add-below. */
export function LessonCanvas(
  props: Pick<EditorActions, 'edit' | 'remove'> & {
    course: Course;
    lesson: Lesson | undefined;
    blockId: string | null;
  },
) {
  const { lesson, blockId, edit } = props;
  const [adding, setAdding] = useState<number | null>(null);
  if (!lesson) {
    return (
      <section aria-label="Lesson" className="min-w-0 flex-1 p-4 md:p-6">
        <p className="text-body text-muted">
          This course has no lessons yet. Add a lesson or a quiz to start.
        </p>
      </section>
    );
  }
  const blocks = lesson.kind === 'content' ? lesson.blocks : [];
  const add = (index: number) => (block: Block) => {
    edit((c) => addBlock(c, lesson.id, block, index), { select: { blockId: block.id } });
    setAdding(null);
  };
  const picker = (index: number) =>
    adding === index && <BlockPicker onAdd={add(index)} onClose={() => setAdding(null)} />;
  const ids = blocks.map((block) => block.id);
  const name = (id: string) => `block ${ids.indexOf(id) + 1}`;
  return (
    <section
      aria-label={`Lesson: ${lesson.title}`}
      className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <TitleField
            label="Lesson title"
            value={lesson.title}
            onChange={(text) =>
              edit((c) => renameLesson(c, lesson.id, text), { group: `lesson-title:${lesson.id}` })
            }
          />
        </div>
        {lesson.kind === 'content' && (
          <NumberField
            label="Minimum time, in seconds"
            hint="Learners can't complete the lesson sooner. Empty means no minimum."
            value={lesson.minimumSeconds}
            min={1}
            max={LIMITS.minimumLessonSeconds}
            onChange={(seconds) =>
              edit((c) => updateLessonDetails(c, lesson.id, { minimumSeconds: seconds }), {
                group: `lesson-minimum:${lesson.id}`,
              })
            }
          />
        )}
      </div>
      {lesson.kind === 'quiz' ? (
        <p className="rounded border border-border p-4 text-small text-muted">
          Quiz questions and settings are edited here once the quiz editor is ready.
        </p>
      ) : (
        <>
          {blocks.length === 0 && (
            <p className="text-body text-muted">This lesson is empty. Add a block to start.</p>
          )}
          <SortableList
            ids={ids}
            name={name}
            onMove={(id, to) => edit((c) => moveBlock(c, id, to))}
          >
            <ol className="flex flex-col gap-3">
              {blocks
                .map((block, index) => (
                  <BlockCard
                    key={block.id}
                    {...props}
                    lessonId={lesson.id}
                    block={block}
                    index={index}
                    count={blocks.length}
                    focused={block.id === blockId}
                    onAddBelow={() => setAdding(index + 1)}
                  />
                ))
                .flatMap((card, index) =>
                  index + 1 < blocks.length && adding === index + 1
                    ? [card, <li key="picker">{picker(index + 1)}</li>]
                    : [card],
                )}
            </ol>
          </SortableList>
          {picker(blocks.length) || (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => setAdding(blocks.length)}
            >
              <Plus aria-hidden />
              Add block
            </Button>
          )}
        </>
      )}
    </section>
  );
}
