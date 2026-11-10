import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
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

// #442: on iPhone the keyboard doesn't shrink the page. The tab bar would ride up above it, and
// iOS scrolls the visible area down the page, taking the app's headers off the top.
describe('MobileLayout with the keyboard open', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  const setup = () => {
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: 390, scale: 1 })
    vi.stubGlobal('visualViewport', vv)
    render(
      <AuthProvider>
        <MobileLayout currentRoute="mobile-gig-list" onNavigate={vi.fn()}>
          <input aria-label="Search organizations" />
        </MobileLayout>
      </AuthProvider>
    )
    const field = screen.getByLabelText('Search organizations') as HTMLInputElement
    const keyboard = (open: boolean, offsetTop = 0) => act(() => {
      if (open) field.focus(); else field.blur()
      Object.assign(vv, { height: open ? window.innerHeight - 320 : window.innerHeight, offsetTop })
      vv.dispatchEvent(new Event('resize'))
    })
    return { field, keyboard }
  }

  it('hides the tab bar while the keyboard is open, and shows it again after', () => {
    const { keyboard } = setup()
    expect(screen.getByTestId('mobile-bottom-nav')).toBeVisible()
    keyboard(true)
    expect(screen.getByTestId('mobile-bottom-nav')).not.toBeVisible()
    keyboard(false)
    expect(screen.getByTestId('mobile-bottom-nav')).toBeVisible()
  })

  it('stays pinned to the visible area when iOS scrolls it down for the keyboard', () => {
    const { keyboard } = setup()
    const root = document.querySelector('.mobile-layout-root') as HTMLElement
    keyboard(true, 140)
    expect(root.style.top).toBe('140px')
    expect(root.style.height).toBe(`${window.innerHeight - 320}px`)
    keyboard(false, 0)
    expect(root.style.top).toBe('0px')
    expect(root.style.height).toBe(`${window.innerHeight}px`)
  })

  it('scrolls a focused field into view inside the page', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { field } = setup()
      const scroll = vi.fn()
      field.scrollIntoView = scroll
      fireEvent.focus(field)
      act(() => { vi.advanceTimersByTime(400) })
      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    } finally {
      vi.useRealTimers()
    }
  })
})
