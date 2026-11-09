import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A21: what may load at start-up. The built entry chunk itself is checked by npm run check:bundle;
// these keep the imports that decide it from drifting back.
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const importers = (pkg: string) =>
  sourceFiles(join(root, 'src'))
    .filter((f) => new RegExp(`from ['"]${pkg}['"]`).test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f));

describe('entry chunk inputs (A21)', () => {
  it('recharts is not a dependency and nothing imports it', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies.recharts).toBeUndefined();
    expect(importers('recharts')).toEqual([]);
  });

  it('react-big-calendar is imported only by the lazy gig list screen', () => {
    expect(importers('react-big-calendar')).toEqual(['src/components/GigListScreen.tsx']);
    expect(read('src/routes/screens.tsx')).toMatch(/lazy\(\(\) => import\('\.\.\/components\/GigListScreen'\)\)/);
  });

  it('the guards load the rarely seen gate screens on demand', () => {
    const guards = read('src/routes/guards.tsx');
    for (const screen of [
      'UserProfileCompletionScreen',
      'TemporaryPasswordScreen',
      'TwoFactorChallengeScreen',
      'TwoFactorSetupRequiredScreen',
      'AcceptInvitationScreen',
      'ResetPasswordScreen',
      'CalendarAuthCallback',
    ]) {
      expect(guards, screen).not.toMatch(new RegExp(`^import ${screen} from`, 'm'));
      expect(guards, screen).toMatch(new RegExp(`const ${screen} = lazy\\(`));
    }
    // The sign-in screen stays eager: a signed-out visit shows it without a chunk fetch.
    expect(guards).toMatch(/^import LoginScreen from/m);
  });

  it('the profile dialog loads the first time it opens', () => {
    const app = read('src/App.tsx');
    expect(app).not.toMatch(/^import EditUserProfileDialog from/m);
    expect(app).toMatch(/const EditUserProfileDialog = lazy\(/);
  });
});
