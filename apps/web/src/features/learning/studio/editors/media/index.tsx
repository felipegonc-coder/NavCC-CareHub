import type { GalleryBlock, ImageBlock } from '@carehub/learning';
import type { JSX } from 'react';
import type { EditorProps } from './editor-props';
import { GalleryEditor } from './GalleryEditor';
import { ImageEditor } from './ImageEditor';

// Media block editors (B10). B8's studio/editors/registry.tsx spreads `mediaEditors` into the editors.
export type { EditorProps } from './editor-props';

/** The editors of the media blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const mediaEditors: {
  image: (props: EditorProps<ImageBlock>) => JSX.Element;
  gallery: (props: EditorProps<GalleryBlock>) => JSX.Element;
} = {
  image: ImageEditor,
  gallery: GalleryEditor,
};
