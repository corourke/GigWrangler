// A14: the database is reached only through src/services. Used by eslint.config.js (the rule)
// and src/test/dbAccess.test.ts (which keeps the allowlist exact).

/**
 * Files outside src/services that still call .from()/.rpc() directly. Each A10/A14 PR moves its
 * screens' calls into services and removes them here; the last one leaves this empty.
 */
export const DB_ACCESS_ALLOWLIST = [
  'src/components/AdminOrganizationsScreen.tsx',
  'src/components/OrganizationScreen.tsx',
  'src/components/gig/GigParticipantsSection.tsx',
  'src/components/gig/GigStaffSlotsSection.tsx',
  'src/components/gig/useGigFinancialsData.ts',
  'src/components/mobile/MobileSettings.tsx',
  'src/hooks/useMobileLock.ts',
];

/**
 * eslint no-restricted-syntax selector: a .from() or .rpc() call whose first argument is a string
 * (a table, bucket or function name). Array.from(items) takes no string, so it is not matched.
 */
export const DB_ACCESS_SELECTOR =
  "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(from|rpc)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]";

export const DB_ACCESS_MESSAGE =
  'Reach the database through a service in src/services, not from a component or hook (A14).';

/** The same test as the selector, on source text (for the allowlist check). */
export function isDbAccessCall(source) {
  return /\.(from|rpc)\(\s*['"`]/.test(source);
}
