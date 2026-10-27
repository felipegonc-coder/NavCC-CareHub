import { z } from 'zod';

// main.tsx imports this first, before any schema is made. The Content-Security-Policy allows no
// eval, so zod's compiled parsers can't run in Care Hub; without `jitless`, zod tries
// `new Function` once to find out, and the browser reports that as a CSP violation.
z.config({ jitless: true });
