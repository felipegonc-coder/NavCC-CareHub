import { sidebarRowClasses, ThemeSwitch, VisuallyHidden } from '@carehub/ui';
import { Settings } from 'lucide-react';
import { Component, Suspense, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { SidebarItem, SidebarSection } from '../../slots';
import { WorkspaceMenu } from './workspace-menu';

/** Keeps one feature's broken sidebar piece from taking the whole shell down with it. */
class SlotBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}

function Badge({ useBadge }: { useBadge: () => number | undefined }) {
  const count = useBadge();
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden
        className="ml-auto min-w-5 rounded-full bg-danger px-1.5 text-center text-label font-medium text-bg"
      >
        {count > 99 ? '99+' : count}
      </span>
      <VisuallyHidden>, {count} new</VisuallyHidden>
    </>
  );
}

interface SidebarLinkProps {
  to: string;
  onNavigate: (() => void) | undefined;
  children: ReactNode;
}

function SidebarLink({ to, onNavigate, children }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }: { isActive: boolean }) => sidebarRowClasses({ active: isActive })}
    >
      {children}
    </NavLink>
  );
}

export interface ShellSidebarProps {
  /** In slot order (apps/web/src/slots.ts sorts them). */
  items: readonly SidebarItem[];
  sections: readonly SidebarSection[];
  /** Called when one of the sidebar's own links is followed, to close the phone menu. */
  onNavigate?: () => void;
}

/** The sidebar's content, used both fixed on the left and in the phone menu. */
export function ShellSidebar({ items, sections, onNavigate }: ShellSidebarProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 shrink-0 items-center px-2 max-md:h-14 max-md:pr-14">
        <WorkspaceMenu onNavigate={onNavigate} />
      </div>
      <nav
        aria-label="Sidebar"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
      >
        {items.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {items.map(({ id, label, icon: Icon, to, useBadge }) => (
              <li key={id}>
                <SidebarLink to={to} onNavigate={onNavigate}>
                  <span aria-hidden className="flex shrink-0">
                    <Icon className="size-4" />
                  </span>
                  <span className="truncate">{label}</span>
                  {useBadge && (
                    <SlotBoundary>
                      <Badge useBadge={useBadge} />
                    </SlotBoundary>
                  )}
                </SidebarLink>
              </li>
            ))}
          </ul>
        )}
        {sections.map(({ id, Component: Section }) => (
          <SlotBoundary key={id}>
            <Section />
          </SlotBoundary>
        ))}
        <ul className="mt-auto flex flex-col gap-0.5">
          <li>
            <SidebarLink to="/settings" onNavigate={onNavigate}>
              <Settings aria-hidden />
              <span>Settings</span>
            </SidebarLink>
          </li>
        </ul>
      </nav>
      <div className="shrink-0 border-t px-3 py-2">
        <ThemeSwitch compact />
      </div>
    </div>
  );
}
