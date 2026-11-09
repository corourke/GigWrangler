/** Characterization tests (A10): the enrolled-device list on mobile Settings. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileSettings from './MobileSettings'
import { startRegistration } from '@simplewebauthn/browser'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }))

const db = vi.hoisted(() => ({
  devices: [] as Array<{ id: string; device_name: string; created_at: string; last_used_at: string }>,
  fail: false,
  deleted: [] as string[],
  invoke: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))
vi.mock('../../utils/supabase/client', async () => {
  const { vi } = await import('vitest')
  db.invoke = vi.fn()
  return {
    createClient: () => ({
      functions: { invoke: db.invoke },
      from: (table: string) => ({
        select: () => ({
          order: async () => (db.fail ? { data: null, error: new Error('boom') } : { data: [...db.devices], error: null }),
        }),
        delete: () => ({
          eq: async (_col: string, id: string) => {
            db.deleted.push(id)
            db.devices = db.devices.filter((d) => d.id !== id)
            return { error: table === 'user_devices' ? null : new Error('wrong table') }
          },
        }),
      }),
    }),
  }
})

const device = (id: string, name: string) => ({ id, device_name: name, created_at: '2026-01-01T00:00:00Z', last_used_at: '2026-01-02T00:00:00Z' })

beforeEach(() => {
  vi.clearAllMocks()
  db.devices = [device('d1', 'Phone A')]
  db.fail = false
  db.deleted = []
})

describe('MobileSettings: devices', () => {
  it('shows a spinner, then the enrolled devices', async () => {
    const { container } = render(<MobileSettings onLogout={vi.fn()} onLock={vi.fn()} />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(await screen.findByText('Phone A')).toBeInTheDocument()
  })

  it('says the devices failed to load', async () => {
    db.fail = true
    render(<MobileSettings onLogout={vi.fn()} onLock={vi.fn()} />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load enrolled devices'))
    expect(screen.getByText('No devices enrolled')).toBeInTheDocument()
  })

  it('removing a device takes it off the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MobileSettings onLogout={vi.fn()} onLock={vi.fn()} />)
    await screen.findByText('Phone A')
    fireEvent.click(screen.getByRole('button', { name: 'Remove device' }))
    await waitFor(() => expect(screen.queryByText('Phone A')).not.toBeInTheDocument())
    expect(db.deleted).toEqual(['d1'])
    expect(toast.success).toHaveBeenCalledWith('Device removed')
  })

  it('enrolling a device reloads the list', async () => {
    db.invoke.mockImplementation(async (path: string) => {
      if (path === 'server/webauthn/register/verify') db.devices = [device('d2', 'Phone B'), ...db.devices]
      return { data: { challenge: 'c' }, error: null }
    })
    vi.mocked(startRegistration).mockResolvedValue({ id: 'cred' } as any)
    render(<MobileSettings onLogout={vi.fn()} onLock={vi.fn()} />)
    await screen.findByText('Phone A')
    fireEvent.click(screen.getByRole('button', { name: /enroll|add|register/i }))
    expect(await screen.findByText('Phone B')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Device enrolled successfully!')
  })
})
