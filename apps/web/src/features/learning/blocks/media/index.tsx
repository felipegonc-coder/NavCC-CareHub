import type { BlockViews } from '../registry';
import { AudioView } from './AudioView';
import { EmbedView } from './EmbedView';
import { FileView } from './FileView';
import { GalleryView } from './GalleryView';
import { ImageView } from './ImageView';
import { LabeledGraphicView } from './LabeledGraphicView';
import { VideoView } from './VideoView';

// Media block views (B10): image, gallery, labeled graphic, video, audio, file and embed. Created
// empty by B5 (decision 0308); B10 fills it, and blocks/registry.tsx spreads it into `blockViews`.
export const mediaViews: BlockViews = {
  image: ImageView,
  gallery: GalleryView,
  labeled_graphic: LabeledGraphicView,
  video: VideoView,
  audio: AudioView,
  file: FileView,
  embed: EmbedView,
};
