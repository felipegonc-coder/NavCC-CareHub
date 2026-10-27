import type { BlockEditors } from '../registry';
import { EmbedEditor } from './EmbedEditor';
import { GalleryEditor } from './GalleryEditor';
import { ImageEditor } from './ImageEditor';
import { LabeledGraphicEditor } from './LabeledGraphicEditor';

/**
 * Editors for image, gallery, labeled graphic and embed blocks (B10). The video, audio and file editors
 * come next; until then the canvas shows a note for them.
 */
export const mediaEditors: BlockEditors = {
  image: ImageEditor,
  gallery: GalleryEditor,
  labeled_graphic: LabeledGraphicEditor,
  embed: EmbedEditor,
};
