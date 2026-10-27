import type { BlockViews } from '../registry';

// Media block views (B10): image, gallery, labeled graphic, video, audio, file and embed. Created
// empty by B5 (decision 0308); B10 fills it, and blocks/registry.tsx spreads it into `blockViews`.
export const mediaViews: BlockViews = {};
