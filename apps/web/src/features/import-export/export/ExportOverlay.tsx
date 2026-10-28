import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { fetchExportAllowed } from './api';
import { ExportDialog } from './ExportDialog';
import {
  closeExportDialog,
  rememberExportAllowed,
  setExportNavigate,
  useExportTarget,
} from './store';

const PAGE_PATH = /^\/p\/([0-9a-f-]{36})(?:\/|$)/i;

/**
 * Rendered once by the app shell (the `overlays` slot): the Export dialog when the page menu opens
 * it, and, as each page opens, whether its menu shows Export (IE-16).
 */
export function ExportOverlay() {
  const target = useExportTarget();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pageId = PAGE_PATH.exec(pathname)?.[1];

  useEffect(() => setExportNavigate((to) => void navigate(to)), [navigate]);

  useQuery({
    queryKey: ['import-export', 'allowed', pageId],
    queryFn: async ({ signal }) => {
      const id = pageId ?? '';
      const allowed = await fetchExportAllowed(id, signal);
      rememberExportAllowed(id, allowed);
      return allowed;
    },
    enabled: pageId !== undefined,
  });

  return target ? <ExportDialog target={target} onClose={closeExportDialog} /> : null;
}
