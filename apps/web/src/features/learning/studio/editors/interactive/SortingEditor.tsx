import { LIMITS, newId, type SortingBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { ChoiceGroup } from '../media/ChoiceGroup';
import type { EditorProps } from '../media/editor-props';
import { ItemList } from '../media/ItemList';

type Category = SortingBlock['categories'][number];

/** A sorting block: its categories, then the items and the category each belongs in. */
export function SortingEditor({ block, onChange }: EditorProps<SortingBlock>) {
  const { categories, items } = block;
  const first = categories[0];
  const options = categories.map((category, index) => ({
    value: category.id,
    label: category.title.trim() || `Category ${index + 1}`,
  }));

  // Items of a removed category move to the first one left.
  function setCategories(next: Category[]) {
    const kept = new Set(next.map((category) => category.id));
    const fallback = next[0]?.id;
    onChange({
      ...block,
      categories: next,
      items: items.map((item) =>
        kept.has(item.categoryId) || !fallback ? item : { ...item, categoryId: fallback },
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-small font-medium text-fg">Categories</legend>
        <p className="text-small text-muted">
          Learners sort each item into one of these. Removing one moves its items to the first.
        </p>
        <ItemList
          noun="Category"
          items={categories}
          max={LIMITS.sortingCategories}
          min={items.length > 0 ? 1 : 0}
          newItem={() => ({ id: newId(), title: '' })}
          onChange={setCategories}
        >
          {(category, update) => (
            <Field label="Name">
              <Input
                value={category.title}
                maxLength={LIMITS.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
          )}
        </ItemList>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-small font-medium text-fg">Items</legend>
        {first ? (
          <ItemList
            noun="Item"
            items={items}
            max={LIMITS.sortingItems}
            newItem={() => ({ id: newId(), text: '', categoryId: first.id })}
            onChange={(next) => onChange({ ...block, items: next })}
          >
            {(item, update) => (
              <>
                <Field label="Text">
                  <Input
                    value={item.text}
                    maxLength={LIMITS.shortText}
                    onChange={(event) => update({ text: event.target.value })}
                  />
                </Field>
                <ChoiceGroup
                  legend="Belongs in"
                  value={item.categoryId}
                  options={options}
                  onChange={(categoryId) => update({ categoryId })}
                />
              </>
            )}
          </ItemList>
        ) : (
          <p className="text-small text-muted">Add a category first.</p>
        )}
      </fieldset>
    </div>
  );
}
