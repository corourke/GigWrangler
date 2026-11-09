import { describe, it, expect, vi } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'
import React from 'react'
import { useNavigation } from './NavigationContext'
import { NavigationProvider } from './NavigationProvider'

const defaultHandlers = {
  onNavigateToDashboard: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onNavigateToTeam: vi.fn(),
  onNavigateToAssets: vi.fn(),
  onNavigateToFinancials: vi.fn(),
}

describe('NavigationProvider', () => {
  it('renders children without crashing', () => {
    expect(() =>
      render(
        <NavigationProvider {...defaultHandlers}>
          <div>child</div>
        </NavigationProvider>
      )
    ).not.toThrow()
  })

  it('renders child content', () => {
    render(
      <NavigationProvider {...defaultHandlers}>
        <span>hello world</span>
      </NavigationProvider>
    )
    expect(screen.getByText('hello world')).toBeTruthy()
  })
})

describe('useNavigation', () => {
  it('returns null outside of NavigationProvider', () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current).toBeNull()
  })

  it('returns context value with required callbacks inside provider', () => {
    const handlers = {
      onNavigateToDashboard: vi.fn(),
      onNavigateToGigs: vi.fn(),
      onNavigateToTeam: vi.fn(),
      onNavigateToAssets: vi.fn(),
      onNavigateToFinancials: vi.fn(),
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider {...handlers}>{children}</NavigationProvider>
    )

    const { result } = renderHook(() => useNavigation(), { wrapper })

    expect(result.current).not.toBeNull()
    expect(result.current?.onNavigateToDashboard).toBe(handlers.onNavigateToDashboard)
    expect(result.current?.onNavigateToGigs).toBe(handlers.onNavigateToGigs)
    expect(result.current?.onNavigateToTeam).toBe(handlers.onNavigateToTeam)
    expect(result.current?.onNavigateToAssets).toBe(handlers.onNavigateToAssets)
  })

  it('propagates optional callbacks when supplied', () => {
    const handlers = {
      ...defaultHandlers,
      onEditProfile: vi.fn(),
      onNavigateToSettings: vi.fn(),
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider {...handlers}>{children}</NavigationProvider>
    )

    const { result } = renderHook(() => useNavigation(), { wrapper })

    expect(result.current?.onEditProfile).toBe(handlers.onEditProfile)
    expect(result.current?.onNavigateToSettings).toBe(handlers.onNavigateToSettings)
  })

  it('optional callbacks are undefined when not supplied', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider {...defaultHandlers}>{children}</NavigationProvider>
    )

    const { result } = renderHook(() => useNavigation(), { wrapper })

    expect(result.current?.onEditProfile).toBeUndefined()
    expect(result.current?.onNavigateToSettings).toBeUndefined()
  })

  it('calling a navigation callback invokes the provided handler', () => {
    const onNavigateToDashboard = vi.fn()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider
        {...defaultHandlers}
        onNavigateToDashboard={onNavigateToDashboard}
      >
        {children}
      </NavigationProvider>
    )

    const { result } = renderHook(() => useNavigation(), { wrapper })
    result.current?.onNavigateToDashboard()

    expect(onNavigateToDashboard).toHaveBeenCalledOnce()
  })
})
