import type { BlockEditors } from '../registry';
import { AudioEditor } from './AudioEditor';
import { EmbedEditor } from './EmbedEditor';
import { FileEditor } from './FileEditor';
import { GalleryEditor } from './GalleryEditor';
import { ImageEditor } from './ImageEditor';
import { LabeledGraphicEditor } from './LabeledGraphicEditor';
import { VideoEditor } from './VideoEditor';

/** Editors for image, gallery, labeled graphic, video, audio, file and embed blocks (B10). */
export const mediaEditors: BlockEditors = {
  image: ImageEditor,
  gallery: GalleryEditor,
  labeled_graphic: LabeledGraphicEditor,
  video: VideoEditor,
  audio: AudioEditor,
  file: FileEditor,
  embed: EmbedEditor,
};
