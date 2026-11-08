import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ModeratorAccessRequestsScreen from './ModeratorAccessRequestsScreen'
import { makeUser } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'

vi.mock('./AppHeader', () => ({ default: () => null }))
vi.mock('../hooks/useAccessRequests', () => ({
  useModeratorAccessRequests: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useDecideAccessRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('ModeratorAccessRequestsScreen page header (#39)', () => {
  it('puts Back to Select Organization in the header slot', () => {
    const onBack = vi.fn()
    render(<ModeratorAccessRequestsScreen user={makeUser()} onBack={onBack} onLogout={vi.fn()} onEditProfile={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Access Requests' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Select Organization'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('ModeratorAccessRequestsScreen subtitle', () => {
  it('names requests to join too', () => {
    render(<ModeratorAccessRequestsScreen user={makeUser()} onBack={vi.fn()} onLogout={vi.fn()} onEditProfile={vi.fn()} />)
    expect(screen.getByText('Requests to join, claim or raise access on organizations with no Admin yet.')).toBeInTheDocument()
  })
})
