import { useEffect } from 'react';
import { useGallery } from './api';
import { SaveTemplateDialog } from './save-dialog';
import { closeSaveAsTemplate, setSaveAllowed, useSaveRequest } from './save-store';

/**
 * Rendered once by the app shell (the `overlays` slot): Save as template, opened from the page
 * menu. It also learns from the gallery whether the person may save templates.
 */
export function TemplatesOverlay() {
  const gallery = useGallery();
  const canSave = gallery.data?.canSave ?? false;
  const page = useSaveRequest();

  useEffect(() => {
    setSaveAllowed(canSave);
  }, [canSave]);

  if (!page || !canSave) return null;
  return <SaveTemplateDialog key={page.id} page={page} onClose={closeSaveAsTemplate} />;
}
