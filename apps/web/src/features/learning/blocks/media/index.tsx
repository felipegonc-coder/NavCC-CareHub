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
import { AudioView } from './AudioView';
import { EmbedView } from './EmbedView';
import { FileView } from './FileView';
import { GalleryView } from './GalleryView';
import { ImageView } from './ImageView';
import { LabeledGraphicView } from './LabeledGraphicView';
import { VideoView } from './VideoView';
import type { ViewProps } from './view-props';

// Media block views (B10). B5's blocks/registry.tsx spreads `mediaViews` into `blockViews`.
export { Picture, type PictureProps } from './Picture';
export { RichTextView, type RichTextViewProps } from './RichTextView';
export { finishedBefore, type ViewProps } from './view-props';

/** The views of the media blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const mediaViews: {
  image: (props: ViewProps<ImageBlock>) => JSX.Element;
  gallery: (props: ViewProps<GalleryBlock>) => JSX.Element;
  labeled_graphic: (props: ViewProps<LabeledGraphicBlock>) => JSX.Element;
  video: (props: ViewProps<VideoBlock>) => JSX.Element;
  audio: (props: ViewProps<AudioBlock>) => JSX.Element;
  file: (props: ViewProps<FileBlock>) => JSX.Element;
  embed: (props: ViewProps<EmbedBlock>) => JSX.Element;
} = {
  image: ImageView,
  gallery: GalleryView,
  labeled_graphic: LabeledGraphicView,
  video: VideoView,
  audio: AudioView,
  file: FileView,
  embed: EmbedView,
};
