// Pure helpers for scripts/check-bundle-size.mjs (kept free of fs so they can
// be unit-tested).

export const LIMITS = {
  // Our own budget for the entry chunk (main bundle). Well under the per-file
  // limit so there is headroom for growth, such as a real Sentry DSN pulling
  // in ~72 KB more.
  entryMax: 1_200_000,
  // Workbox's default `maximumFileSizeToCacheInBytes`. A larger file is
  // silently dropped from the service worker's precache, which breaks offline.
  fileMax: 2_097_152,
};

/**
 * Entry chunk path (relative to the build dir, no leading slash) from
 * build/index.html: the `<script type="module" src=...>`. Several chunks are
 * named `index-*`, so the name alone doesn't identify the entry.
 */
/** Source maps in the build output. They are uploaded to Sentry and deleted (A18); one left over
 * would be served publicly and precached. */
export function findSourceMaps(names) {
  return names.filter((name) => name.endsWith('.map'));
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
