import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginScreen from './LoginScreen'

// Shared auth mock — hoisted so the mock factory can reference it before the
// const declarations are reached by the JS engine.
const mockAuth = vi.hoisted(() => ({
  signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  signUp: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
  getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'test@example.com' } }, error: null }),
}))

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: mockAuth })),
}))

vi.mock('../services/organization.service', () => ({
  convertPendingToActive: vi.fn().mockResolvedValue(undefined),
}))

const _mockOnLogin = vi.fn()

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default happy-path behaviour
    mockAuth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null })
    mockAuth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: null })
    mockAuth.signInWithOAuth.mockResolvedValue({ data: {}, error: null })
    mockAuth.getUser.mockResolvedValue({ data: { user: { email: 'test@example.com' } }, error: null })
  })

  it('renders without throwing errors', () => {
    expect(() => render(<LoginScreen />)).not.toThrow()
  })

  it('renders the sign-in email and password inputs', () => {
    render(<LoginScreen />)
    expect(document.getElementById('signin-email')).not.toBeNull()
    expect(document.getElementById('signin-password')).not.toBeNull()
  })

  it('renders the sign-in submit button', () => {
    render(<LoginScreen />)
    expect(screen.getByRole('button', { name: /sign in with email/i })).toBeTruthy()
  })

  it('disables the submit button while a sign-in is in flight', async () => {
    // Never resolves — simulates a slow network
    mockAuth.signInWithPassword.mockReturnValue(new Promise(() => {}))

    render(<LoginScreen />)

    const emailInput = document.getElementById('signin-email') as HTMLInputElement
    const passwordInput = document.getElementById('signin-password') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })

    const submitButton = screen.getByRole('button', { name: /sign in with email/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(submitButton).toBeDisabled()
    })
  })

  it('displays an error alert when sign-in returns an auth error', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })

    render(<LoginScreen />)

    const emailInput = document.getElementById('signin-email') as HTMLInputElement
    const passwordInput = document.getElementById('signin-password') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'wrong@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'wrongpass' } })

    fireEvent.click(screen.getByRole('button', { name: /sign in with email/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/invalid email or password/i)
      ).toBeTruthy()
    })
  })

  it('calls signInWithPassword with the entered email and password', async () => {
    // Return an error so we don't need to stub the full post-login flow
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'test error' },
    })

    render(<LoginScreen />)

    const emailInput = document.getElementById('signin-email') as HTMLInputElement
    const passwordInput = document.getElementById('signin-password') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'secret123' } })

    fireEvent.click(screen.getByRole('button', { name: /sign in with email/i }))

    await waitFor(() => {
      expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'secret123',
      })
    })
  })

  it('renders the Google sign-in button', () => {
    render(<LoginScreen />)
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy()
  })

  it('renders both Sign In and Sign Up tab triggers', () => {
    render(<LoginScreen />)
    expect(screen.getByRole('tab', { name: /sign in/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /sign up/i })).toBeTruthy()
  })

  it('shows the current year in the footer copyright (#159)', () => {
    // Fake only Date so the async auth mocks keep using real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-03-01T12:00:00Z'))
    try {
      render(<LoginScreen />)
      expect(screen.getByText('© 2031 GigWrangler. All rights reserved.')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('Sign Up password fields', () => {
    const openSignUp = () => {
      render(<LoginScreen />)
      // Radix Tabs activate on mousedown, not click
      fireEvent.mouseDown(screen.getByRole('tab', { name: /sign up/i }), { button: 0, ctrlKey: false })
      return {
        firstName: document.getElementById('signup-firstname') as HTMLInputElement,
        lastName: document.getElementById('signup-lastname') as HTMLInputElement,
        email: document.getElementById('signup-email') as HTMLInputElement,
        password: document.getElementById('signup-password') as HTMLInputElement,
        confirm: document.getElementById('signup-confirm-password') as HTMLInputElement,
      }
    }

    const fillSignUp = (fields: ReturnType<typeof openSignUp>, password: string, confirm: string) => {
      fireEvent.change(fields.firstName, { target: { value: 'Ada' } })
      fireEvent.change(fields.lastName, { target: { value: 'Lovelace' } })
      fireEvent.change(fields.email, { target: { value: 'ada@example.com' } })
      fireEvent.change(fields.password, { target: { value: password } })
      fireEvent.change(fields.confirm, { target: { value: confirm } })
    }

    it('renders a confirm password field', () => {
      const fields = openSignUp()
      expect(fields.confirm).not.toBeNull()
      expect(fields.confirm.type).toBe('password')
    })

    it('shows an inline mismatch error and does not call signUp', async () => {
      const fields = openSignUp()
      fillSignUp(fields, 'hunter22', 'hunter23')

      expect(screen.getByText('Passwords do not match')).toBeTruthy()
      expect(fields.confirm.getAttribute('aria-invalid')).toBe('true')

      fireEvent.submit(fields.confirm.closest('form')!)

      await new Promise((r) => setTimeout(r, 0))
      expect(mockAuth.signUp).not.toHaveBeenCalled()
      expect(screen.getByText('Passwords do not match')).toBeTruthy()
    })

    it('blocks submit when the confirmation is left empty', async () => {
      const fields = openSignUp()
      fillSignUp(fields, 'hunter22', '')
      // No error until the user has typed a confirmation or tried to submit
      expect(screen.queryByText('Passwords do not match')).toBeNull()

      fireEvent.submit(fields.confirm.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeTruthy()
      })
      expect(mockAuth.signUp).not.toHaveBeenCalled()
    })

    it('calls signUp when the passwords match', async () => {
      const fields = openSignUp()
      fillSignUp(fields, 'hunter2222', 'hunter2222')

      expect(screen.queryByText('Passwords do not match')).toBeNull()

      fireEvent.submit(fields.confirm.closest('form')!)

      await waitFor(() => {
        expect(mockAuth.signUp).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'ada@example.com', password: 'hunter2222' })
        )
      })
    })

    it('shows a strength hint that updates as the password changes', () => {
      const fields = openSignUp()
      expect(screen.queryByText(/password strength/i)).toBeNull()

      fireEvent.change(fields.password, { target: { value: 'abcdef' } })
      expect(screen.getByText(/password strength: weak/i)).toBeTruthy()

      fireEvent.change(fields.password, { target: { value: 'abcdefg1' } })
      expect(screen.getByText(/password strength: fair/i)).toBeTruthy()

      fireEvent.change(fields.password, { target: { value: 'abcdefghiJK1' } })
      expect(screen.getByText(/password strength: strong/i)).toBeTruthy()
    })

    it('says the minimum is 10 characters', () => {
      openSignUp()
      expect(screen.getByText(/minimum 10 characters/i)).toBeTruthy()
    })

    it('refuses a password under 10 characters and does not call signUp', async () => {
      const fields = openSignUp()
      fillSignUp(fields, 'hunter222', 'hunter222')

      fireEvent.submit(fields.confirm.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Password must be at least 10 characters')).toBeTruthy()
      })
      expect(mockAuth.signUp).not.toHaveBeenCalled()
    })

    it('does not block submit on a weak (but 10+ character) password', async () => {
      const fields = openSignUp()
      fillSignUp(fields, 'abcdefghij', 'abcdefghij')
      expect(screen.getByText(/password strength: weak/i)).toBeTruthy()

      fireEvent.submit(fields.confirm.closest('form')!)

      await waitFor(() => {
        expect(mockAuth.signUp).toHaveBeenCalled()
      })
    })
  })
})
