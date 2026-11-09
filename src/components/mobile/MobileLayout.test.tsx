import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MobileLayout from './MobileLayout'
import { AuthProvider } from '../../contexts/AuthProvider'

vi.mock('../../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  })),
}))

describe('MobileLayout', () => {
  it('keeps bottom nav non-intercepting so main content can own vertical scroll', () => {
    render(
      <AuthProvider>
        <MobileLayout currentRoute="mobile-gig-list" onNavigate={vi.fn()}>
          <div>Body Content</div>
        </MobileLayout>
      </AuthProvider>
    )

    const nav = screen.getByTestId('mobile-bottom-nav')
    const main = screen.getByTestId('mobile-main-content')

    expect(nav.style.touchAction).not.toBe('none')
    expect(main.style.overflowY).toBe('auto')
  })
})
