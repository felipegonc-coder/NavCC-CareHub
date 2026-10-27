import type {
  AudioBlock,
  EmbedBlock,
  FileBlock,
  GalleryBlock,
  ImageBlock,
  LabeledGraphicBlock,
  VideoBlock,
} from '@carehub/learning';
import type { JSX } from 'react';
import { AudioEditor } from './AudioEditor';
import type { EditorProps } from './editor-props';
import { EmbedEditor } from './EmbedEditor';
import { FileEditor } from './FileEditor';
import { GalleryEditor } from './GalleryEditor';
import { ImageEditor } from './ImageEditor';
import { LabeledGraphicEditor } from './LabeledGraphicEditor';
import { VideoEditor } from './VideoEditor';

// Media block editors (B10). B8's studio/editors/registry.tsx spreads `mediaEditors` into the editors.
export type { EditorProps } from './editor-props';

/** The editors of the media blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const mediaEditors: {
  image: (props: EditorProps<ImageBlock>) => JSX.Element;
  gallery: (props: EditorProps<GalleryBlock>) => JSX.Element;
  labeled_graphic: (props: EditorProps<LabeledGraphicBlock>) => JSX.Element;
  video: (props: EditorProps<VideoBlock>) => JSX.Element;
  audio: (props: EditorProps<AudioBlock>) => JSX.Element;
  file: (props: EditorProps<FileBlock>) => JSX.Element;
  embed: (props: EditorProps<EmbedBlock>) => JSX.Element;
} = {
  image: ImageEditor,
  gallery: GalleryEditor,
  labeled_graphic: LabeledGraphicEditor,
  video: VideoEditor,
  audio: AudioEditor,
  file: FileEditor,
  embed: EmbedEditor,
};
