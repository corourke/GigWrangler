#!/usr/bin/env node
// Retakes user-guide screenshots from the dev demo data. See README.md.
//
//   node scripts/screenshots/shoot.mjs                    all shots
//   node scripts/screenshots/shoot.mjs --only gigs/       shots whose id starts with gigs/
//   node scripts/screenshots/shoot.mjs --list             list shots and their pages
import { chromium } from 'playwright';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shots } from './shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outRoot = path.join(repoRoot, 'website/docs/src/assets/screenshots');
const logFile = path.join(here, 'taken.json');

const BASE = process.env.SHOT_BASE_URL || 'http://localhost:3000';
const CHROMIUM = process.env.SHOT_CHROMIUM || '/opt/pw-browsers/chromium';
// The demo world's "today". Must match the anchor the seed was run with.
const ANCHOR = process.env.SHOT_ANCHOR || '2026-10-07';
const TIMEZONE = 'America/Los_Angeles';
const PASSWORD = 'demo-pass-2026';
const VIEWPORT = { width: 1200, height: 900 };
const USERS = {
  admin: 'demo-admin@gigwrangler.test',
  manager: 'demo-manager@gigwrangler.test',
  staff: 'demo-staff@gigwrangler.test',
  viewer: 'demo-viewer@gigwrangler.test',
  newuser: 'demo-newuser@gigwrangler.test',
  moderator: 'demo-moderator@gigwrangler.test',
  // Cedar Hall's Viewer: another organization's view of a shared gig (#175).
  venue: 'vera.holm@cedar-hall.example',
};

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of shots) console.log(`${s.id.padEnd(50)} ${s.page}`);
  process.exit(0);
}
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] ?? '' : '';
const selected = shots.filter((s) => s.id.startsWith(only));
if (!selected.length) {
  console.error(`No shots match "${only}". Use --list to see them.`);
  process.exit(1);
}

// SQL on the dev project only, as scripts/seed-demo.sh runs it: auth is injected by the
// environment's proxy, and no token is read or sent here. Returns null when it can't run.
const DEV_REF = 'qcrzwsazasaojqoqxwnr';
const SQL_API = `${process.env.SHOT_SQL_API_BASE || 'https://api.supabase.com/v1/projects'}/${DEV_REF}/database/query`;
const devSql = (query) => {
  try {
    const out = execFileSync('curl', ['-sS', '-X', 'POST', SQL_API, '-H', 'Content-Type: application/json', '-d', '@-'],
      { input: JSON.stringify({ query }), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
};

// Signing in through the form updates each demo user's last sign-in, which the team
// table shows as Last Login. Note the seeded times before anyone signs in, and put them
// back before the shots that show them and at the end of the run.
const DEMO_EMAILS = Object.values(USERS).map((e) => `'${e}'`).join(', ');
const seenTimes = devSql(`select id, last_sign_in_at from auth.users where email in (${DEMO_EMAILS})`);
if (!seenTimes) console.warn('note  Could not read the demo users\' last sign-in (dev SQL unavailable); Last Login will show this run\'s times.');
const restoreSignIns = () => {
  if (!seenTimes?.length) return;
  const values = seenTimes
    .map((r) => `('${r.id}'::uuid, ${r.last_sign_in_at ? `'${r.last_sign_in_at}'::timestamptz` : 'null'})`)
    .join(', ');
  devSql(`update auth.users u set last_sign_in_at = v.t from (values ${values}) as v(id, t) where u.id = v.id returning u.id`);
};

const ctx = { base: BASE, users: USERS, password: PASSWORD, restoreSignIns };
const browser = await chromium.launch({ executablePath: CHROMIUM });
const newContext = (viewport, storageState) =>
  browser.newContext({
    viewport: viewport ?? VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light', // the app has no dark mode for users
    reducedMotion: 'reduce',
    timezoneId: TIMEZONE,
    ...(storageState ? { storageState } : {}),
  });
// Freeze "now" at 10 AM Pacific on the anchor date, so Upcoming/Past and
// "next 30 days" match the seed.
const pinClock = (page) => page.clock.install({ time: new Date(`${ANCHOR}T10:00:00-07:00`) });

// Sign each demo user in once, through the real form, and reuse the session.
const sessions = {};
const sessionFor = async (user) => {
  if (!user) return undefined;
  if (!sessions[user]) {
    const c = await newContext();
    const page = await c.newPage();
    await pinClock(page);
    await page.goto(BASE);
    await page.locator('#signin-email').fill(USERS[user]);
    await page.locator('#signin-password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).last().click();
    await page.waitForURL((u) => !/\/(login)?$/.test(u.pathname), { timeout: 30000 });
    sessions[user] = await c.storageState();
    await c.close();
  }
  return sessions[user];
};

let appCommit = 'unknown';
try { appCommit = execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim(); } catch {}
const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : {};

let failed = 0;
for (const shot of selected) {
  const c = await newContext(shot.viewport, await sessionFor(shot.user));
  const page = await c.newPage();
  await pinClock(page);
  try {
    await shot.prepare(page, ctx);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    let clip = typeof shot.clip === 'function' ? await shot.clip(page) : shot.clip;
    if (!clip) {
      const targets = [shot.target(page)].flat();
      const boxes = await Promise.all(targets.map((t) => t.boundingBox()));
      if (boxes.some((b) => !b)) throw new Error('target not found');
      const pad = shot.pad ?? 0;
      const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
      const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
      const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
      const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
      clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    const out = path.join(outRoot, `${shot.id}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, clip });
    log[shot.id] = { page: shot.page, user: shot.user, sources: shot.sources, anchor: ANCHOR, taken: new Date().toISOString().slice(0, 10), appCommit };
    console.log(`ok    ${shot.id}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${shot.id}: ${err.message.split('\n').slice(0, 4).join(' | ')}`);
  }
  await c.close();
}
await browser.close();
restoreSignIns();
const sorted = Object.fromEntries(Object.keys(log).sort().map((k) => [k, log[k]]));
fs.writeFileSync(logFile, JSON.stringify(sorted, null, 2) + '\n');
process.exit(failed ? 1 : 0);
