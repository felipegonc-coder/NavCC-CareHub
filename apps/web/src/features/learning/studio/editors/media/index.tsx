import type { AudioBlock, GalleryBlock, ImageBlock, VideoBlock } from '@carehub/learning';
import type { JSX } from 'react';
import { AudioEditor } from './AudioEditor';
import type { EditorProps } from './editor-props';
import { GalleryEditor } from './GalleryEditor';
import { ImageEditor } from './ImageEditor';
import { VideoEditor } from './VideoEditor';

// Media block editors (B10). B8's studio/editors/registry.tsx spreads `mediaEditors` into the editors.
export type { EditorProps } from './editor-props';

/** The editors of the media blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const mediaEditors: {
  image: (props: EditorProps<ImageBlock>) => JSX.Element;
  gallery: (props: EditorProps<GalleryBlock>) => JSX.Element;
  video: (props: EditorProps<VideoBlock>) => JSX.Element;
  audio: (props: EditorProps<AudioBlock>) => JSX.Element;
} = {
  image: ImageEditor,
  gallery: GalleryEditor,
  video: VideoEditor,
  audio: AudioEditor,
};
