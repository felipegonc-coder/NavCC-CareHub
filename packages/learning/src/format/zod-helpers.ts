// Internal schema helpers for the format module (not re-exported from the package).
import { z } from 'zod';

/** Plain text up to `max` characters. May be empty in drafts; publish checks ask for the text that matters. */
export const text = (max: number) => z.string().max(max);

/** Plain text that can never be empty. */
export const requiredText = (max: number) => z.string().min(1).max(max);

/** A percentage of an image's width or height. */
export const percent = () => z.number().min(0).max(100);
