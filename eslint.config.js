import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
// eslint-plugin-jsx-a11y 6.10.2 declares ESLint ^3-9 as its peer and runs fine on our ESLint 10;
// package.json "overrides" points its eslint peer at ours ("$eslint") so npm ci installs it.
// Drop that override once a release declares ESLint 10.
import jsxA11y from 'eslint-plugin-jsx-a11y';

import { DB_ACCESS_ALLOWLIST, DB_ACCESS_SELECTOR, DB_ACCESS_MESSAGE } from './scripts/dbAccess.mjs';

// B11: a date column is a calendar day; new Date('2026-03-01') is the evening before west of UTC.
const DATE_COLUMN_RULES = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=1] > MemberExpression.arguments[property.name=/^(date|due_date|purchase_date|acquisition_date|retired_on|filed_on|tax_date|disposed_on)$/]",
    message: 'A date column is a calendar day: use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts), not new Date().',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=1] > Identifier.arguments[name=/^(dueDate|due_date|purchase_date|purchaseDate|acquisition_date|retired_on|retiredOn|filed_on)$/]",
    message: 'A date column is a calendar day: use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts), not new Date().',
  },
];

export default tseslint.config(
  {
    ignores: [
      'build/',
      'dev-dist/',
      '.wrangler/',
      'supabase/functions/',
      'node_modules/',
      'public/',
      // website/docs is a separate Astro subproject with its own build
      // output and generated types; it isn't part of this root lint config
      'website/docs/dist/',
      'website/docs/.astro/',
      'website/docs/node_modules/',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A11: both hook and fast-refresh rules are errors. Where an effect deliberately leaves a
      // dependency out, the line carries an eslint-disable comment saying why.
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      // Burn-down debt (tracked in docs/development/coding-guide.md):
      // - no-explicit-any: the codebase predates strict typing (~500 `any`s);
      //   tighten to 'error' as services/components are refactored (Phase 7)
      // - the react-hooks v6 compiler rules (set-state-in-effect, immutability,
      //   refs, purity, …) flag real but Phase-7-sized refactors in the large
      //   screen components; re-enable as those components are split
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/exhaustive-deps': 'error',
      // Unused function params are idiomatic (callbacks, destructured props);
      // unused locals/imports remain errors
      // B11: a date column is a calendar day; new Date('2026-03-01') is the evening before west
      // of UTC. Use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts).
      'no-restricted-syntax': ['error', ...DATE_COLUMN_RULES],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  // A14: components and hooks reach the database through src/services. The files still on
  // DB_ACCESS_ALLOWLIST (scripts/dbAccess.mjs) are moved over by the A10/A14 PRs.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/**', 'src/test/**', 'src/**/*.test.{ts,tsx}', ...DB_ACCESS_ALLOWLIST],
    rules: {
      'no-restricted-syntax': ['error', ...DATE_COLUMN_RULES, { selector: DB_ACCESS_SELECTOR, message: DB_ACCESS_MESSAGE }],
    },
  },
  // A19: accessibility. jsx-a11y's recommended rules are errors.
  {
    files: ['src/**/*.tsx'],
    // Tests render stand-in markup for mocked components.
    ignores: ['src/**/*.test.tsx'],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Every recommended rule is an error (A19). Where a rule doesn't fit (a pointer-only aid, a
      // focus move into a field just opened), the line says why in an eslint-disable comment.
    },
  }
);
