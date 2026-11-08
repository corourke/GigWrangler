import { z } from 'zod';

// The app's Content-Security-Policy has no 'unsafe-eval' (public/_headers). zod 4 otherwise
// probes for eval with `new Function("")` the first time it parses an object, to compile a
// faster parser; jitless skips the probe and uses the regular parser. Imported first in main.tsx.
z.config({ jitless: true });
