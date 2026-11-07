import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROD = 'postgresql://postgres.hqnnhtxcxedisasvtbqv:pw@pooler.example.com:5432/postgres';
const DEV = 'postgresql://postgres.qcrzwsazasaojqoqxwnr:pw@pooler.example.com:5432/postgres';

let dest;
let bin;
beforeEach(() => {
  dest = mkdtempSync(join(tmpdir(), 'gw-backup-test-'));
  // Stand-in PostgreSQL 17 client tools, so the dry runs need no real install.
  bin = mkdtempSync(join(tmpdir(), 'gw-backup-bin-'));
  for (const tool of ['pg_dump', 'pg_restore']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} (PostgreSQL) 17.4"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
});
afterEach(() => {
  rmSync(dest, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

function run(script, args, env = {}) {
  const base = { PATH: `${bin}:${process.env.PATH}`, HOME: dest };
  const r = spawnSync('bash', [script, ...args], { env: { ...base, ...env }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('backup-prod.sh', () => {
  it('refuses a missing database URL', () => {
    const r = run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no database URL/);
  });

  it('refuses the development project and any project that is not production', () => {
    expect(run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest], { GIGWRANGLER_PROD_DB_URL: DEV }).out)
      .toMatch(/development project/);
    const other = run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest],
      { GIGWRANGLER_PROD_DB_URL: 'postgresql://postgres.someoneelse:pw@h/postgres' });
    expect(other.code).toBe(1);
    expect(other.out).toMatch(/does not name the production project/);
  });

  it('in a dry run, names what it would write and delete, and changes nothing', () => {
    mkdirSync(join(dest, '2000-01-01'));
    writeFileSync(join(dest, '2000-01-01', 'gigwrangler-prod.dump'), 'old');
    const r = run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest],
      { GIGWRANGLER_PROD_DB_URL: PROD});
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/would write .*gigwrangler-prod\.dump/);
    expect(r.out).toMatch(/would delete .*2000-01-01/);
    expect(existsSync(join(dest, '2000-01-01'))).toBe(true);
    expect(existsSync(join(dest, 'backup.log'))).toBe(false);
  });

  it('refuses pg_dump older than the server (17)', () => {
    writeFileSync(join(bin, 'pg_dump'), '#!/bin/sh\necho "pg_dump (PostgreSQL) 16.2"\n');
    const r = run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest], { GIGWRANGLER_PROD_DB_URL: PROD });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/use pg_dump 17 or newer/);
  });

  it('never prints the database URL or its password', () => {
    const r = run('scripts/backup-prod.sh', ['--dry-run', '--dest', dest],
      { GIGWRANGLER_PROD_DB_URL: PROD});
    expect(r.out).not.toContain('pw@');
    expect(r.out).not.toContain('pooler.example.com');
  });
});

describe('restore-drill.sh', () => {
  it('refuses a remote server', () => {
    const r = run('scripts/restore-drill.sh', ['--dry-run', '--dest', dest], { PGHOST: 'db.example.com' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/local server only/);
  });

  it('refuses while a production URL is in the environment', () => {
    const r = run('scripts/restore-drill.sh', ['--dry-run', '--dest', dest], { GIGWRANGLER_PROD_DB_URL: PROD });
    expect(r.code).toBe(1);
  });

  it('refuses a database it may not drop', () => {
    const r = run('scripts/restore-drill.sh', ['--dry-run', '--dest', dest, '--db', 'postgres']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/must start with gw_restore_drill/);
  });

  it('picks the newest backup in a dry run', () => {
    for (const day of ['2026-01-01', '2026-02-01']) {
      mkdirSync(join(dest, day));
      writeFileSync(join(dest, day, 'gigwrangler-prod.dump'), 'x');
    }
    const r = run('scripts/restore-drill.sh', ['--dry-run', '--dest', dest]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/2026-02-01\/gigwrangler-prod\.dump into local database gw_restore_drill/);
  });
});
