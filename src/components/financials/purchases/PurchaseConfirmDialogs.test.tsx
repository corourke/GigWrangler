/**
 * Round B: the Delete Purchase / Delete Line Item dialog's paragraphs sit in valid HTML (no <p>
 * inside the description's <p>), so React logs no DOM nesting warning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeletePurchaseDialog, type DeleteConfirm } from './PurchaseConfirmDialogs'
import type { DbPurchase } from '../../../utils/supabase/types'

const purchase = { id: 'p1', asset_id: 'a1' } as unknown as DbPurchase
const nestingErrors = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((args: unknown[]) => args.some((a) => /cannot be a descendant of|validateDOMNesting/.test(String(a))))

describe('DeletePurchaseDialog markup', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each<[string, DeleteConfirm]>([
    ['a purchase', { type: 'header', purchase, childCount: 3, purchaseIds: ['p1'] }],
    ['a line linked to an asset', { type: 'item', purchase, purchaseIds: ['p1'] }],
  ])('deleting %s logs no DOM nesting warning', (_label, confirm) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<DeletePurchaseDialog confirm={confirm} linked={{ entries: 1, gigs: 1, amount: 40 }} onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/removes \$40\.00 of expenses from 1 gig/)).toBeInTheDocument()
    expect(nestingErrors(spy)).toEqual([])
    expect(screen.getByRole('alertdialog').querySelector('p p')).toBeNull()
  })
})
