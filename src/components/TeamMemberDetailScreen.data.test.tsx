/** Characterization tests (A10): member detail load, failure, switching member, and remove. */
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TeamMemberDetailScreen from './TeamMemberDetailScreen'
import { getOrganizationMember, removeMember } from '../services/organization.service'
import { makeUser, makeOrganization } from '../test/factories'

vi.mock('./AppHeader', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../services/organization.service', () => ({
  getOrganizationMember: vi.fn(),
  getStaffRoles: vi.fn().mockResolvedValue([]),
  updateMemberDetails: vi.fn().mockResolvedValue({}),
  removeMember: vi.fn(),
}))

const member = (id: string, first: string) => ({
  id,
  created_at: '2026-01-15T00:00:00Z',
  role: 'Staff',
  default_staff_role_id: null,
  user: { id: `user-${id}`, first_name: first, last_name: 'Tester', email: `${id}@example.com`, user_status: 'active' },
})

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { ...utils, rerender: (next: ReactElement) => utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) }
}

const baseProps = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  memberId: 'm1',
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrganizationMember).mockImplementation(async (_org: string, id: string) =>
    (id === 'm1' ? member('m1', 'Avery') : member('m2', 'Blake')) as any)
})

describe('TeamMemberDetailScreen: loading', () => {
  it('shows a spinner, then the member', async () => {
    const { container } = render(<TeamMemberDetailScreen {...baseProps} onBack={vi.fn()} />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: /Avery Tester/ })).toBeInTheDocument()
    expect(getOrganizationMember).toHaveBeenCalledWith('org-1', 'm1')
  })

  it('on a failed load, says so and goes back', async () => {
    const { toast } = await import('sonner')
    vi.mocked(getOrganizationMember).mockRejectedValue(new Error('Member not found'))
    const onBack = vi.fn()
    render(<TeamMemberDetailScreen {...baseProps} onBack={onBack} />)
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith('Member not found')
  })

  it('switching to another member loads that member', async () => {
    const { rerender } = render(<TeamMemberDetailScreen {...baseProps} onBack={vi.fn()} />)
    await screen.findByRole('heading', { level: 1, name: /Avery Tester/ })
    rerender(<TeamMemberDetailScreen {...baseProps} memberId="m2" onBack={vi.fn()} />)
    expect(await screen.findByRole('heading', { level: 1, name: /Blake Tester/ })).toBeInTheDocument()
    expect(getOrganizationMember).toHaveBeenCalledWith('org-1', 'm2')
  })
})

describe('TeamMemberDetailScreen: remove', () => {
  it('removes the member after confirming, then goes back', async () => {
    vi.mocked(removeMember).mockResolvedValue(undefined as any)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onBack = vi.fn()
    render(<TeamMemberDetailScreen {...baseProps} onBack={onBack} />)
    await screen.findByRole('heading', { level: 1, name: /Avery Tester/ })
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('org-1', 'm1'))
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  })

  it('stays on the member when the remove fails', async () => {
    const { toast } = await import('sonner')
    vi.mocked(removeMember).mockRejectedValue(new Error('Cannot remove'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onBack = vi.fn()
    render(<TeamMemberDetailScreen {...baseProps} onBack={onBack} />)
    await screen.findByRole('heading', { level: 1, name: /Avery Tester/ })
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot remove'))
    expect(onBack).not.toHaveBeenCalled()
  })
})
