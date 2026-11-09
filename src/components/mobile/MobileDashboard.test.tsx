import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MobileDashboard from './MobileDashboard'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getStaffAssignments: vi.fn().mockResolvedValue([]),
    putStaffAssignments: vi.fn().mockResolvedValue(undefined),
    addToOutbox: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/mobile/staffDashboard.service', () => ({
  fetchMyUpcomingAssignments: vi.fn(),
}))

vi.mock('../../services/gig.service', () => ({
  updateStaffAssignmentStatus: vi.fn(),
}))

import { idbStore } from '../../utils/idb/store'
import { fetchMyUpcomingAssignments } from '../../services/mobile/staffDashboard.service'


// Screens read through react-query (A10), so each render gets its own QueryClient.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('MobileDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(idbStore.getStaffAssignments).mockResolvedValue([])
    vi.mocked(fetchMyUpcomingAssignments).mockResolvedValue([])
  })

  it('does not show hard error UI for AbortError during refresh', async () => {
    vi.mocked(fetchMyUpcomingAssignments).mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError')
    )

    render(<MobileDashboard onViewGigDetail={vi.fn()} onViewAllGigs={vi.fn()} />)

    await waitFor(() => {
      expect(screen.queryByText('Error loading assignments')).not.toBeInTheDocument()
    })
  })

  it('shows empty state when no assignments', async () => {
    render(<MobileDashboard onViewGigDetail={vi.fn()} onViewAllGigs={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('No upcoming assignments')).toBeInTheDocument()
    })
  })
})
