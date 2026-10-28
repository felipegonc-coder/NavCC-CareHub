import { useId, type CSSProperties } from 'react';
import { Checkbox, cn } from '@carehub/ui';
import type { Property, View } from '@carehub/databases';
import { isApiError, UNKNOWN_ERROR_MESSAGE } from '../api';
import { PropertyMenu, type PropertyMenuProps } from './cell-adapter';
import { tableOptions, type TableColumn } from './columns';
import { columnItems, HeaderCell, PropertiesMenu } from './header';
import { TABLE_TEXT } from './messages';
import type { ColumnTools } from './use-column-tools';

/** What every column's PropertyMenu (W3-3's) gets, the same for each column. */
export type HeaderMenuProps = Omit<
  PropertyMenuProps,
  'property' | 'viewItems' | 'open' | 'onOpenChange' | 'onError' | 'children'
>;

export interface TableHeaderProps {
  view: View;
  columns: readonly TableColumn[];
  /** Every property the viewer can see, in the view's order (for the + menu). */
  properties: readonly Property[];
  /** The viewer can change the view for everyone (edit_views). */
  editable: boolean;
  /** The select-all box, for people who can tick rows: its column's class and state. */
  selectAll: { className: string; checked: boolean | 'indeterminate'; onToggle(): void } | null;
  /** With virtual rows, the header's row number. */
  rowIndex?: number;
  placeOf(column: TableColumn): CSSProperties;
  cellClass(column: TableColumn): string;
  tools: ColumnTools;
  menu: HeaderMenuProps;
  /** Says why a change in a column's menu was refused. */
  say(text: string): void;
}

/**
 * The table's header row: the select-all box, each column's header with its menu (PropertyMenu
 * with the table's own items), and the + menu to show properties.
 */
export function TableHeader({
  view,
  columns,
  properties,
  editable,
  selectAll,
  rowIndex,
  placeOf,
  cellClass,
  tools,
  menu,
  say,
}: TableHeaderProps) {
  const selectAllId = useId();
  const options = tableOptions(view);
  const shown = new Set(columns.map((c) => c.property.id));
  const { menuFor, setMenuFor, moving } = tools;
  return (
    <div role="rowgroup">
      <div role="row" aria-rowindex={rowIndex} className="flex border-b border-border">
        {selectAll && (
          <div role="columnheader" className={cn(selectAll.className, 'min-h-9 max-md:min-h-11')}>
            {/* Room for the rows' handles, so the boxes line up. */}
            <span aria-hidden className="w-4 shrink-0 max-md:hidden" />
            {/* The label fills the cell on phones, so the box has a 44 px target. */}
            <label
              htmlFor={selectAllId}
              className="flex items-center justify-center max-md:size-11"
            >
              <Checkbox
                id={selectAllId}
                checked={selectAll.checked}
                aria-label={TABLE_TEXT.selectAll}
                onCheckedChange={selectAll.onToggle}
              />
            </label>
          </div>
        )}
        {columns.map((column) => (
          <HeaderCell
            key={column.property.id}
            column={column}
            style={placeOf(column)}
            className={cellClass(column)}
            editable={editable}
            menu={(button) => (
              <PropertyMenu
                {...menu}
                property={column.property}
                viewItems={columnItems({
                  column,
                  editable,
                  frozenHere: options.frozenUpTo === column.property.id,
                  grouped: view.grouping?.propertyId === column.property.id,
                  calculation: view.calculations[column.property.id],
                  change: tools.columnChanges(column),
                })}
                open={menuFor === column.property.id}
                onOpenChange={(open) =>
                  setMenuFor((now) =>
                    open ? column.property.id : now === column.property.id ? null : now,
                  )
                }
                onError={(error) => say(isApiError(error) ? error.message : UNKNOWN_ERROR_MESSAGE)}
              >
                {button}
              </PropertyMenu>
            )}
            onPress={() => tools.pressHeader(column)}
            onFocus={(button) => tools.focusHeader(column, button)}
            moving={moving?.propertyId === column.property.id}
            onMoveStart={(event) => tools.startMove(event, column, columns)}
            onResizeStart={(event) => tools.startResize(event, column)}
          />
        ))}
        {editable && (
          <div role="columnheader" className="flex shrink-0 items-center px-1">
            <PropertiesMenu
              properties={properties}
              shown={shown}
              wrapCells={options.wrapCells}
              onShow={tools.showColumn}
              onWrapCells={tools.wrapCells}
            />
          </div>
        )}
      </div>
    </div>
  );
}
