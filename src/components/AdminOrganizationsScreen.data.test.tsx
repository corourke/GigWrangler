/** Characterization tests (A10): the admin organization list loads, fails, and deletes as today. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQuery as render } from '../test/renderWithQuery'
import AdminOrganizationsScreen from './AdminOrganizationsScreen'
import { makeUser } from '../test/factories'

vi.mock('./AppHeader', () => ({ default: () => null }))
const invoke = vi.fn()
const rpc = vi.fn()
vi.mock('../utils/supabase/client', () => ({
  createClient: () => ({ functions: { invoke }, rpc }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))


const orgA = { id: 'org-a', name: 'Org A', roles: ['Production'], claimed: true, city: null, state: null, phone_number: null }
const orgB = { id: 'org-b', name: 'Org B', roles: ['Venue'], claimed: true, city: null, state: null, phone_number: null }
let serverOrgs: typeof orgA[] = []

const props = {
  user: makeUser(),
  organizations: [
    { organization: { id: 'org-a', name: 'Org A' }, role: 'Admin' },
    { organization: { id: 'org-b', name: 'Org B' }, role: 'Admin' },
  ] as any,
  onEditOrganization: vi.fn(),
  onCreateOrganization: vi.fn(),
  onBack: vi.fn(),
  onLogout: vi.fn(),
  onEditProfile: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  serverOrgs = [orgA, orgB]
  rpc.mockResolvedValue({ data: false, error: null })
  invoke.mockImplementation(async (path: string, opts: { method: string }) => {
    if (path === 'server/organizations') return { data: serverOrgs, error: null }
    if (opts.method === 'DELETE') {
      const id = path.split('/').pop()
      serverOrgs = serverOrgs.filter((o) => o.id !== id)
      return { data: { success: true }, error: null }
    }
    return { data: [{ id: 'm1' }, { id: 'm2' }], error: null }
  })
})

describe('AdminOrganizationsScreen: loading', () => {
  it('shows a spinner, then the organizations with their member counts', async () => {
    const { container } = render(<AdminOrganizationsScreen {...props} />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    const row = (await screen.findByText('Org A')).closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Org B')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('shows the error when the list fails to load', async () => {
    invoke.mockImplementation(async () => ({ data: null, error: new Error('Server unavailable') }))
    render(<AdminOrganizationsScreen {...props} />)
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument()
    expect(screen.getByText('No Organizations Found')).toBeInTheDocument()
  })
})

describe('AdminOrganizationsScreen: delete', () => {
  it('removes the deleted organization from the list', async () => {
    const onOrganizationDeleted = vi.fn()
    render(<AdminOrganizationsScreen {...props} onOrganizationDeleted={onOrganizationDeleted} />)
    const row = (await screen.findByText('Org A')).closest('tr')!
    fireEvent.click(within(row).getByTitle('Delete Organization'))
    fireEvent.click(await screen.findByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(screen.queryByText('Org A')).not.toBeInTheDocument())
    expect(screen.getByText('Org B')).toBeInTheDocument()
    expect(onOrganizationDeleted).toHaveBeenCalledWith('org-a')
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-a', { method: 'DELETE' })
  })

  it('keeps the organization and shows the reason when the delete is refused', async () => {
    const { toast } = await import('sonner')
    render(<AdminOrganizationsScreen {...props} />)
    const row = (await screen.findByText('Org A')).closest('tr')!
    invoke.mockImplementation(async (path: string) =>
      path === 'server/organizations' ? { data: serverOrgs, error: null } : { data: null, error: new Error('Has other members') })
    fireEvent.click(within(row).getByTitle('Delete Organization'))
    fireEvent.click(await screen.findByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Has other members'))
    expect(screen.getByText('Org A')).toBeInTheDocument()
  })
})
