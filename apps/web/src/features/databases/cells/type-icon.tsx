import type { PropertyType } from '@carehub/databases';
import { cn } from '@carehub/ui';
import {
  AlignLeft,
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  Calendar,
  CircleDot,
  Clock,
  Fingerprint,
  Hash,
  Link,
  ListChecks,
  Loader,
  MousePointerClick,
  Paperclip,
  Phone,
  Search,
  Sigma,
  SquareCheck,
  Tags,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<PropertyType, LucideIcon> = {
  title: Type,
  text: AlignLeft,
  number: Hash,
  select: CircleDot,
  multi_select: Tags,
  status: Loader,
  date: Calendar,
  checkbox: SquareCheck,
  url: Link,
  email: AtSign,
  phone: Phone,
  person: User,
  files: Paperclip,
  relation: ArrowUpRight,
  checklist: ListChecks,
  created_time: Clock,
  edited_time: Clock,
  created_by: User,
  edited_by: User,
  formula: Sigma,
  rollup: Search,
  unique_id: Fingerprint,
  button: MousePointerClick,
  verification: BadgeCheck,
};

/** The icon for a property type, beside its name in headers and menus. Decorative only. */
export function PropertyTypeIcon({ type, className }: { type: PropertyType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-muted', className)} />;
}
