import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from '@testing-library/react'
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

describe('MobileLayout bottom nav: the Today tab (§3e)', () => {
  const tabs = (role: any) => {
    render(
      <AuthProvider>
        <MobileLayout currentRoute="mobile-today" onNavigate={vi.fn()} userRole={role}>
          <div />
        </MobileLayout>
      </AuthProvider>
    )
    return Array.from(screen.getByTestId('mobile-bottom-nav').querySelectorAll('button')).map((b) => b.textContent)
  }

  it('comes first for Staff, before My Schedule', () => {
    expect(tabs('Staff')).toEqual(['Today', 'Dashboard', 'Scanning', 'Settings'])
  })

  it('comes first for Admin and Manager, before Gigs', () => {
    expect(tabs('Admin')).toEqual(['Today', 'Gigs', 'Scanning', 'Settings'])
  })

  it('is not shown to a Viewer', () => {
    expect(tabs('Viewer')).toEqual(['Gigs', 'Scanning', 'Settings'])
  })

  it('shows Today as the current tab on the Today screen', () => {
    render(
      <AuthProvider>
        <MobileLayout currentRoute="mobile-today" onNavigate={vi.fn()} userRole="Manager">
          <div />
        </MobileLayout>
      </AuthProvider>
    )
    const today = screen.getByRole('button', { name: 'Today' })
    expect(today).toHaveAttribute('aria-current', 'page')
  })
})

// #442: on iPhone the keyboard doesn't shrink the page, so the tab bar would ride up above it.
describe('MobileLayout with the keyboard open', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hides the tab bar while the keyboard is open, and shows it again after', () => {
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: 390 })
    vi.stubGlobal('visualViewport', vv)
    render(
      <AuthProvider>
        <MobileLayout currentRoute="mobile-gig-list" onNavigate={vi.fn()}>
          <div />
        </MobileLayout>
      </AuthProvider>
    )
    expect(screen.getByTestId('mobile-bottom-nav')).toBeVisible()
    act(() => { vv.height = window.innerHeight - 320; vv.dispatchEvent(new Event('resize')) })
    expect(screen.getByTestId('mobile-bottom-nav')).not.toBeVisible()
    act(() => { vv.height = window.innerHeight; vv.dispatchEvent(new Event('resize')) })
    expect(screen.getByTestId('mobile-bottom-nav')).toBeVisible()
  })
})
