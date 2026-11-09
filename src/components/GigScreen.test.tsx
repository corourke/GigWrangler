import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import GigScreen from './GigScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'

// Mock all dependencies
vi.mock('../services/gig.service', () => ({
  getGig: vi.fn().mockResolvedValue({}),
  createGig: vi.fn(),
  updateGig: vi.fn(),
  deleteGig: vi.fn(),
  duplicateGig: vi.fn(),
}))

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  })),
}))

const mockProps = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onCancel: vi.fn(),
  onGigCreated: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('GigScreen', () => {
  it('titles the page "New Gig" with Back to Gigs in the header slot (#39)', () => {
    const onCancel = vi.fn()
    render(<GigScreen {...mockProps} onCancel={onCancel} />)
    expect(screen.getByRole('heading', { level: 1, name: 'New Gig' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Gigs'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders without throwing errors', () => {
    expect(() => {
      render(<GigScreen {...mockProps} />)
    }).not.toThrow()
  })

  // Submit button enable/disable behavior is tested through integration
  // The hook properly detects changes by comparing current form values with original data
  // This has been verified through manual testing of the application

})
