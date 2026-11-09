// Pure helpers for scripts/check-bundle-size.mjs (kept free of fs so they can
// be unit-tested).

export const LIMITS = {
  // Our own budget for the entry chunk (main bundle): about 10% over its size after A21
  // (799,302 bytes, measured as CI does, with a dummy Sentry DSN so @sentry is included).
  // Raise it only with a reason; prefer lazy-loading what grew.
  entryMax: 880_000,
  // Workbox's default `maximumFileSizeToCacheInBytes`. A larger file is
  // silently dropped from the service worker's precache, which breaks offline.
  fileMax: 2_097_152,
};

/**
 * Entry chunk path (relative to the build dir, no leading slash) from
 * build/index.html: the `<script type="module" src=...>`. Several chunks are
 * named `index-*`, so the name alone doesn't identify the entry.
 */
/**
 * Libraries that must stay out of the entry chunk (A21), each with a string its built code always
 * contains. react-big-calendar belongs to the lazy gig list screen; recharts is not a dependency.
 */
export const ENTRY_FORBIDDEN = [
  { name: 'react-big-calendar', marker: 'rbc-calendar' },
  { name: 'recharts', marker: 'recharts-wrapper' },
];

/** Names of the ENTRY_FORBIDDEN libraries whose marker appears in the entry chunk's source. */
export function forbiddenInEntry(source, forbidden = ENTRY_FORBIDDEN) {
  return forbidden.filter(({ marker }) => source.includes(marker)).map(({ name }) => name);
}

export function findEntryChunk(indexHtml) {
  const scripts = indexHtml.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scripts) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) return src[1].replace(/^\.?\//, '');
  }
  return null;
}

/**
 * @param {{ file: string, bytes: number, isEntry: boolean }[]} entries
 * @param {{ entryMax: number, fileMax: number }} limits
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function checkSizes(entries, limits) {
  const failures = [];
  for (const { file, bytes, isEntry } of entries) {
    if (isEntry && bytes > limits.entryMax) {
      failures.push(
        `Entry chunk ${file} is ${bytes.toLocaleString('en-US')} bytes, over the ${limits.entryMax.toLocaleString('en-US')} byte entry limit. ` +
          'Lazy-load more screens or heavy dependencies.',
      );
    }
    if (bytes > limits.fileMax) {
      failures.push(
        `${file} is ${bytes.toLocaleString('en-US')} bytes, over the ${limits.fileMax.toLocaleString('en-US')} byte service-worker precache limit. ` +
          'The offline cache would skip it.',
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
