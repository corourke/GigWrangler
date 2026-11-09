/** A10 characterization: how a category list loads and saves. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import CategoryListEditor from './CategoryListEditor'
import { listCategories, addCategory, updateCategory, getScheduleCLines, getCategoryUsage } from '../../services/purchaseCategory.service'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../services/purchaseCategory.service', () => ({
  listCategories: vi.fn(), addCategory: vi.fn(), updateCategory: vi.fn(), getScheduleCLines: vi.fn(), getCategoryUsage: vi.fn(),
}))

const row = (id: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, organization_id: 'org-1', name, schedule_c_line: '22', default_recovery_period: null, sort_order: 10, active: true, ...over })
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(listCategories).mockReset().mockImplementation(async (kind: string, org: string | null) =>
    [row('c1', `${kind} for ${org ?? 'starter'}`)] as any)
  vi.mocked(addCategory).mockReset().mockImplementation(async (_k: any, org: any, f: any) => ({ id: 'new', organization_id: org, active: true, ...f }))
  vi.mocked(updateCategory).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(getScheduleCLines).mockReset().mockResolvedValue([{ code: '22', label: 'Supplies' }] as any)
  vi.mocked(getCategoryUsage).mockReset().mockResolvedValue({})
  vi.mocked(toast.error).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('CategoryListEditor data (A10 characterization)', () => {
  it('first load: says it is loading, then the list, its lines and its use', async () => {
    const list = deferred<any>()
    vi.mocked(listCategories).mockReturnValueOnce(list.promise)
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    expect(screen.getByText('Loading categories…')).toBeInTheDocument()
    await act(async () => list.resolve([row('c1', 'Supplies')]))
    expect(await screen.findByDisplayValue('Supplies')).toBeInTheDocument()
    expect(getScheduleCLines).toHaveBeenCalled()
    expect(getCategoryUsage).toHaveBeenCalledWith('expense', 'org-1')
  })

  it('the starter set reads no use; equipment reads no Schedule C lines', async () => {
    render(<CategoryListEditor kind="equipment" organizationId={null} canEdit />)
    expect(await screen.findByDisplayValue('equipment for starter')).toBeInTheDocument()
    expect(getCategoryUsage).not.toHaveBeenCalled()
    expect(getScheduleCLines).not.toHaveBeenCalled()
  })

  it('a failed load says so and shows an empty list', async () => {
    vi.mocked(listCategories).mockRejectedValueOnce(new Error('down'))
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load categories'))
    expect(screen.queryByText('Loading categories…')).not.toBeInTheDocument()
  })

  it('another list loads in its place; a slow earlier answer never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(listCategories).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    rerender(<CategoryListEditor kind="equipment" organizationId="org-1" canEdit />)
    expect(await screen.findByDisplayValue('equipment for org-1')).toBeInTheDocument()
    await act(async () => slow.resolve([row('x', 'expense for org-1')]))
    expect(screen.queryByDisplayValue('expense for org-1')).not.toBeInTheDocument()
  })

  it('a change shows at once; if it fails it goes back and says why', async () => {
    let fail!: (e: Error) => void
    vi.mocked(updateCategory).mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    const toggle = await screen.findByRole('switch', { name: 'Use expense for org-1' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Use expense for org-1' })).not.toBeChecked())
    await act(async () => fail(new Error('nope')))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Use expense for org-1' })).toBeChecked())
    expect(toast.error).toHaveBeenCalledWith('Failed to save the change')
  })

  it('a saved change stays', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Use expense for org-1' }))
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('expense', 'c1', { active: false }))
    await act(async () => {})
    expect(screen.getByRole('switch', { name: 'Use expense for org-1' })).not.toBeChecked()
  })

  it('an added category joins the list', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />)
    await screen.findByDisplayValue('expense for org-1')
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Travel' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(await screen.findByDisplayValue('Travel')).toBeInTheDocument()
  })
})
