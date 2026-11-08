import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AdminOrganizationsScreen from './AdminOrganizationsScreen'
import { makeUser } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'

vi.mock('./AppHeader', () => ({ default: () => null }))
const invoke = vi.fn(async (_path: string): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null }))
const rpc = vi.fn(async (_fn: string, _args: unknown): Promise<{ data: unknown; error: unknown }> => ({ data: false, error: null }))
vi.mock('../utils/supabase/client', () => ({
  createClient: () => ({ functions: { invoke }, rpc }),
}))

describe('AdminOrganizationsScreen page header (#39)', () => {
  it('puts Back to Select Organization in the header slot', async () => {
    const onBack = vi.fn()
    render(
      <AdminOrganizationsScreen
        user={makeUser()}
        organizations={[]}
        onEditOrganization={vi.fn()}
        onCreateOrganization={vi.fn()}
        onBack={onBack}
        onLogout={vi.fn()}
        onEditProfile={vi.fn()}
      />,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin: All Organizations' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Select Organization'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

// Who may edit an organization with no Admin of its own, and member counts only where you may see them.
describe('AdminOrganizationsScreen: unclaimed organizations', () => {
  const unclaimed = { id: 'org-u', name: 'Unclaimed Venue', roles: ['Venue'], claimed: false, city: null, state: null, phone_number: null }

  const renderWith = async (canManage: boolean) => {
    invoke.mockImplementation(async (path: string) =>
      path === 'server/organizations' ? { data: [unclaimed], error: null } : { data: null, error: new Error('Not a member of this organization') })
    rpc.mockResolvedValue({ data: canManage, error: null })
    render(
      <AdminOrganizationsScreen
        user={makeUser()}
        organizations={[{ organization: { id: 'org-mine', name: 'Mine' }, role: 'Admin' } as any]}
        onEditOrganization={vi.fn()}
        onCreateOrganization={vi.fn()}
        onBack={vi.fn()}
        onLogout={vi.fn()}
        onEditProfile={vi.fn()}
      />,
    )
    return screen.findByText('Unclaimed Venue')
  }

  it('offers Edit when the server says you may manage it', async () => {
    const name = await renderWith(true)
    const row = name.closest('tr')!
    await waitFor(() => expect(within(row).getByTitle('Edit Organization')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('user_can_manage_unclaimed_org', { p_organization_id: 'org-u', p_user_id: makeUser().id })
  })

  it('does not offer Edit to an Admin of some other organization who may not', async () => {
    const name = await renderWith(false)
    const row = name.closest('tr')!
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(within(row).queryByTitle('Edit Organization')).not.toBeInTheDocument()
  })

  it('shows no member count where the member list is not yours to see', async () => {
    const name = await renderWith(false)
    const row = name.closest('tr')!
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })
})

// The member list is fetched only where it's yours to see (your organizations, or any as a
// moderator), so the page makes no calls that are bound to be refused.
describe('AdminOrganizationsScreen: member lists', () => {
  const mine = { id: 'org-mine', name: 'Mine', roles: ['Production'], claimed: true, city: null, state: null, phone_number: null }
  const theirs = { id: 'org-theirs', name: 'Theirs', roles: ['Venue'], claimed: true, city: null, state: null, phone_number: null }

  const renderAs = async ({ moderator }: { moderator: boolean }) => {
    invoke.mockReset()
    rpc.mockReset()
    invoke.mockImplementation(async (path: string) =>
      path === 'server/organizations' ? { data: [mine, theirs], error: null } : { data: [{ id: 'm1' }], error: null })
    rpc.mockImplementation(async (fn: string) => ({ data: fn === 'is_platform_moderator' ? moderator : false, error: null }))
    const onOrganizationDeleted = vi.fn()
    render(
      <AdminOrganizationsScreen
        user={makeUser()}
        organizations={[{ organization: { id: 'org-mine', name: 'Mine' }, role: 'Admin' } as any]}
        onEditOrganization={vi.fn()}
        onCreateOrganization={vi.fn()}
        onBack={vi.fn()}
        onLogout={vi.fn()}
        onEditProfile={vi.fn()}
        onOrganizationDeleted={onOrganizationDeleted}
      />,
    )
    await screen.findByText('Theirs')
    return { onOrganizationDeleted }
  }

  it("doesn't ask for the members of an organization you aren't in", async () => {
    await renderAs({ moderator: false })
    const paths = invoke.mock.calls.map(([path]) => path)
    expect(paths).toContain('server/organizations/org-mine/members')
    expect(paths).not.toContain('server/organizations/org-theirs/members')
  })

  it('a moderator still sees every count', async () => {
    await renderAs({ moderator: true })
    await waitFor(() => expect(invoke.mock.calls.map(([path]) => path)).toContain('server/organizations/org-theirs/members'))
  })

  it('tells the app when you delete your own organization', async () => {
    const { onOrganizationDeleted } = await renderAs({ moderator: false })
    const row = screen.getByText('Mine').closest('tr')!
    fireEvent.click(within(row).getByTitle('Delete Organization'))
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    fireEvent.click(await screen.findByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(onOrganizationDeleted).toHaveBeenCalledWith('org-mine'))
  })
})
