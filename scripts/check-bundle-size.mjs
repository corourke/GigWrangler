#!/usr/bin/env node
// Fails if the built entry chunk or any JS/CSS asset is too big for the PWA
// precache. Run after `npm run build`:  npm run check:bundle
// For a prod-shaped measurement build with a (dummy) VITE_SENTRY_DSN, since a
// real DSN keeps ~72 KB of @sentry in the main chunk.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkSizes, findEntryChunk, findSourceMaps, forbiddenInEntry, LIMITS } from './bundleSize.mjs';

const buildDir = resolve(process.argv[2] ?? 'build');

let indexHtml;
try {
  indexHtml = readFileSync(join(buildDir, 'index.html'), 'utf8');
} catch (err) {
  console.error(`Cannot read the build output in ${buildDir} (${err.message}). Run "npm run build" first.`);
  process.exit(1);
}

const entryFile = findEntryChunk(indexHtml);
if (!entryFile) {
  console.error('No <script type="module" src=...> in build/index.html, so the entry chunk cannot be identified.');
  process.exit(1);
}

// The JS/CSS live next to the entry chunk (vite.config.ts build.assetsDir)
const assetsSubdir = dirname(entryFile);
const assetsDir = join(buildDir, assetsSubdir);
let assetNames;
try {
  assetNames = readdirSync(assetsDir);
} catch (err) {
  console.error(`Cannot read ${assetsDir} (${err.message}).`);
  process.exit(1);
}

const entries = assetNames
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => {
    const file = `${assetsSubdir}/${name}`;
    return { file, bytes: statSync(join(assetsDir, name)).size, isEntry: file === entryFile };
  });

if (!entries.some((e) => e.isEntry)) {
  console.error(`index.html points at ${entryFile}, which is not in ${assetsDir}.`);
  process.exit(1);
}

const fmt = (n) => n.toLocaleString('en-US').padStart(12);
const top = [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
console.log(`Bundle sizes (${entries.length} JS/CSS files; largest first)`);
for (const e of top) console.log(`${fmt(e.bytes)}  ${e.file}${e.isEntry ? '  <- entry' : ''}`);
const entry = entries.find((e) => e.isEntry);
if (!top.includes(entry)) console.log(`${fmt(entry.bytes)}  ${entry.file}  <- entry`);
console.log(
  `Limits: entry ${LIMITS.entryMax.toLocaleString('en-US')}, any file ${LIMITS.fileMax.toLocaleString('en-US')} bytes`,
);

const { ok: sizesOk, failures } = checkSizes(entries, LIMITS);
const listAll = (dir, prefix = '') =>
  readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listAll(dir, join(prefix, d.name)) : [join(prefix, d.name)],
  );
for (const map of findSourceMaps(listAll(buildDir))) {
  failures.push(`${map} is in the build output. Source maps go to Sentry only and must not be deployed.`);
}
for (const name of forbiddenInEntry(readFileSync(join(buildDir, entryFile), 'utf8'))) {
  failures.push(`${name} is in the entry chunk ${entryFile}. Import it only from a lazy-loaded screen.`);
}
const ok = sizesOk && failures.length === 0;
if (!ok) {
  console.error('\nBundle size check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('Bundle size check passed.');
