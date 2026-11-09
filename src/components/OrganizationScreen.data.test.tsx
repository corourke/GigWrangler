/**
 * Characterization tests (A10): what the edit screen loads and shows, and what a save does.
 * They pin today's behaviour so the move to react-query stays behaviour-neutral.
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrganizationScreen from './OrganizationScreen';
import { makeOrganization } from '../test/factories';

// Per-organization answers the fake database gives.
type OrgFacts = { role?: string; memberCount: number };
const facts: Record<string, OrgFacts> = {};
let globalAdmin = false;
let failLoads = false;
const invoke = vi.fn();
const rpc = vi.fn(async (fn: string, _args?: unknown) => {
  if (failLoads) return { data: null, error: { message: 'boom' } };
  return { data: fn === 'user_is_admin' ? globalAdmin : null, error: null };
});
const fromCalls: Array<{ table: string; orgId?: string }> = [];

function fakeFrom(table: string) {
  let head = false;
  let orgId: string | undefined;
  const builder: any = {
    select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return builder; },
    eq: (col: string, val: string) => { if (col === 'organization_id') orgId = val; return builder; },
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      fromCalls.push({ table, orgId });
      if (failLoads) return Promise.resolve({ data: null, count: null, error: { message: 'boom' } }).then(resolve, reject);
      const f = (orgId && facts[orgId]) || { memberCount: 0 };
      const result = head
        ? { count: f.memberCount, error: null }
        : { data: f.role ? [{ role: f.role }] : [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } } }) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (fn: string, args: unknown) => rpc(fn, args as never),
    from: (table: string) => fakeFrom(table),
  })),
}));

vi.mock('./organization/OrganizationContactsSection', () => ({
  default: (p: { organizationId: string; canManage: boolean }) => (
    <div data-testid="contacts" data-org={p.organizationId} data-can-manage={String(p.canManage)} />
  ),
}));

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return {
    ...utils,
    rerender: (next: ReactElement) => utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  };
}

const claimedOrg = makeOrganization({ id: 'org-a', name: 'Org A', claimed: true, roles: ['Production'] } as any);
const unclaimedOrg = makeOrganization({ id: 'org-b', name: 'Org B', claimed: false, roles: ['Venue'] } as any);
const baseProps = { onOrganizationCreated: vi.fn(), onCancel: vi.fn(), userId: 'user-1' };
const OWN_ADMIN = /already has its own Admin/;
const UNCLAIMED = /hasn't been claimed yet/;

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  failLoads = false;
  globalAdmin = false;
  for (const k of Object.keys(facts)) delete facts[k];
});

describe('OrganizationScreen (edit): permissions load', () => {
  it('first load: says only its own Admin may edit a claimed org you are not Admin of', async () => {
    facts['org-a'] = { role: 'Staff', memberCount: 3 };
    render(<OrganizationScreen {...baseProps} organization={claimedOrg} />);
    expect(screen.queryByText(OWN_ADMIN)).not.toBeInTheDocument();
    expect(await screen.findByText(OWN_ADMIN)).toBeInTheDocument();
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-can-manage', 'false');
    expect(rpc).toHaveBeenCalledWith('user_is_admin', { user_uuid: 'user-1' });
  });

  it('an org Admin may manage contacts and sees no warning', async () => {
    facts['org-a'] = { role: 'Admin', memberCount: 3 };
    render(<OrganizationScreen {...baseProps} organization={claimedOrg} />);
    await waitFor(() => expect(screen.getByTestId('contacts')).toHaveAttribute('data-can-manage', 'true'));
    expect(screen.queryByText(OWN_ADMIN)).not.toBeInTheDocument();
  });

  it('a global admin is told an unclaimed org may be edited by any Admin', async () => {
    globalAdmin = true;
    facts['org-b'] = { memberCount: 2 };
    render(<OrganizationScreen {...baseProps} organization={unclaimedOrg} />);
    expect(await screen.findByText(UNCLAIMED)).toBeInTheDocument();
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-can-manage', 'true');
  });

  it('a failed load shows no warning and keeps the form usable', async () => {
    failLoads = true;
    render(<OrganizationScreen {...baseProps} organization={claimedOrg} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(fromCalls.length).toBeGreaterThan(0));
    expect(screen.queryByText(OWN_ADMIN)).not.toBeInTheDocument();
    expect(document.getElementById('name')).toHaveValue('Org A');
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-can-manage', 'false');
  });

  it('switching to another organization loads that organization', async () => {
    facts['org-a'] = { role: 'Staff', memberCount: 3 };
    facts['org-b'] = { role: 'Admin', memberCount: 1 };
    const { rerender } = render(<OrganizationScreen {...baseProps} organization={claimedOrg} />);
    expect(await screen.findByText(OWN_ADMIN)).toBeInTheDocument();
    rerender(<OrganizationScreen {...baseProps} organization={{ ...unclaimedOrg, claimed: true } as any} />);
    await waitFor(() => expect(screen.queryByText(OWN_ADMIN)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('contacts')).toHaveAttribute('data-org', 'org-b'));
    await waitFor(() => expect(screen.getByTestId('contacts')).toHaveAttribute('data-can-manage', 'true'));
    expect(fromCalls.some((c) => c.orgId === 'org-b')).toBe(true);
  });

  it('makes no permission calls when creating', async () => {
    render(<OrganizationScreen {...baseProps} />);
    await screen.findByRole('heading', { level: 1, name: 'Create New Organization' });
    expect(rpc).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });
});

describe('OrganizationScreen (edit): saving', () => {
  it('saves with a PUT and hands back the saved organization', async () => {
    facts['org-a'] = { role: 'Admin', memberCount: 1 };
    const saved = { ...claimedOrg, name: 'Org A Renamed' };
    invoke.mockResolvedValue({ data: saved, error: null });
    const onOrganizationUpdated = vi.fn();
    render(<OrganizationScreen {...baseProps} organization={claimedOrg} onOrganizationUpdated={onOrganizationUpdated} />);
    fireEvent.change(document.getElementById('name')!, { target: { value: 'Org A Renamed' } });
    fireEvent.submit(document.getElementById('name')!.closest('form')!);
    await waitFor(() => expect(onOrganizationUpdated).toHaveBeenCalledWith(saved));
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-a', {
      method: 'PUT',
      body: expect.objectContaining({ name: 'Org A Renamed' }),
    });
  });

  it('shows the error from a failed save', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Name already taken') });
    render(<OrganizationScreen {...baseProps} organization={claimedOrg} />);
    fireEvent.change(document.getElementById('name')!, { target: { value: 'Other' } });
    fireEvent.submit(document.getElementById('name')!.closest('form')!);
    expect(await screen.findByText('Name already taken')).toBeInTheDocument();
  });

  it('creates with auto_join and reports whether you joined', async () => {
    const created = { id: 'org-new', name: 'New Org' };
    invoke.mockResolvedValue({ data: created, error: null });
    const onOrganizationCreated = vi.fn();
    render(<OrganizationScreen {...baseProps} onOrganizationCreated={onOrganizationCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /fill in manually|enter manually|manually/i }));
    fireEvent.change(document.getElementById('name')!, { target: { value: 'New Org' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /production/i }));
    fireEvent.submit(document.getElementById('name')!.closest('form')!);
    await waitFor(() => expect(onOrganizationCreated).toHaveBeenCalledWith(created, true));
    expect(invoke).toHaveBeenCalledWith('server/organizations', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ name: 'New Org', roles: ['Production'], auto_join: true }),
    }));
  });
});
