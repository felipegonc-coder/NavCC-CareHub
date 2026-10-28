// The values an Add a row or Edit rows step sets: one line per property, with Set a property to
// add one. Dates can be Today or Now with days added, people the person who pressed it, and
// relations this page.
import type { DatabaseMeta, Property } from '@carehub/databases';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@carehub/ui';
import { Plus, Trash2 } from 'lucide-react';
import {
  dayOf,
  firstValue,
  fromDay,
  fromText,
  idsOf,
  optionsOf,
  settableProperties,
  textOf,
  type Values,
} from './values';

function ValueInput({
  property,
  value,
  onChange,
}: {
  property: Property;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const { name } = property;
  switch (property.config.type) {
    case 'select':
    case 'status':
      return (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <SelectTrigger aria-label={name} className="min-w-0 flex-1">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {optionsOf(property).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi_select': {
      const chosen = idsOf(value);
      return (
        <fieldset className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">{name}</legend>
          {optionsOf(property).map((option) => (
            <Field key={option.id} label={option.name} layout="inline">
              <Checkbox
                checked={chosen.includes(option.id)}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  onChange(
                    checked === true
                      ? [...chosen, option.id]
                      : chosen.filter((id) => id !== option.id),
                  )
                }
              />
            </Field>
          ))}
        </fieldset>
      );
    }
    case 'date': {
      const day = dayOf(value);
      return (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Select
            value={day.dynamic}
            onValueChange={(dynamic: string) =>
              onChange(fromDay({ ...day, dynamic: dynamic === 'now' ? 'now' : 'today' }))
            }
          >
            <SelectTrigger aria-label={name} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="now">Now</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-small text-muted">+</span>
          <Input
            type="number"
            inputMode="numeric"
            min={-3650}
            max={3650}
            aria-label={`Days added to ${name}`}
            className="w-20"
            value={String(day.offsetDays)}
            onChange={(event) => {
              const days = Math.trunc(Number(event.target.value) || 0);
              onChange(fromDay({ ...day, offsetDays: Math.max(-3650, Math.min(3650, days)) }));
            }}
          />
          <span className="text-small text-muted">days</span>
        </div>
      );
    }
    case 'checkbox':
      return (
        <Switch
          aria-label={name}
          checked={value === true}
          onCheckedChange={(checked: boolean) => onChange(checked)}
        />
      );
    case 'person':
      return <span className="flex-1 text-small">The person who pressed it</span>;
    case 'relation':
      return <span className="flex-1 text-small">This page</span>;
    default:
      return (
        <Input
          aria-label={name}
          className="min-w-0 flex-1"
          inputMode={property.config.type === 'number' ? 'decimal' : undefined}
          value={textOf(value)}
          onChange={(event) => onChange(fromText(property, event.target.value))}
        />
      );
  }
}

export interface ValuesFieldProps {
  meta: DatabaseMeta | undefined;
  values: Values;
  onChange(values: Values): void;
}

export function ValuesField({ meta, values, onChange }: ValuesFieldProps) {
  const properties = settableProperties(meta);
  const set = properties.filter((property) => property.id in values);
  const unset = properties.filter((property) => !(property.id in values));
  const without = (propertyId: string) =>
    Object.fromEntries(Object.entries(values).filter(([id]) => id !== propertyId));

  return (
    <div className="flex flex-col gap-2">
      {set.length > 0 && (
        <ul className="flex flex-col gap-2">
          {set.map((property) => (
            <li key={property.id} className="flex flex-wrap items-center gap-2">
              <span className="w-28 shrink-0 truncate text-small font-medium">{property.name}</span>
              <ValueInput
                property={property}
                value={values[property.id]}
                onChange={(value) => onChange({ ...values, [property.id]: value })}
              />
              <IconButton
                label={`Don’t set ${property.name}`}
                size="sm"
                onClick={() => onChange(without(property.id))}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {unset.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start">
              <Plus aria-hidden />
              Set a property
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {unset.map((property) => (
              <DropdownMenuItem
                key={property.id}
                onSelect={() => onChange({ ...values, [property.id]: firstValue(property) })}
              >
                {property.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
