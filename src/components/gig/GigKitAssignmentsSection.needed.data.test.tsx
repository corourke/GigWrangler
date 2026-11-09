/** A10 characterization: after the gig's kits save, Equipment needed is read again. */
import { renderWithQuery } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import GigKitAssignmentsSection from './GigKitAssignmentsSection'
import { getGigKits, updateGigKitAssignments } from '../../services/gig.service'
import { getEquipmentNeeded } from '../../services/conflictDetection.service'

const kit = (id: string, name: string) => ({ id, name, tag_number: null, category: 'Sound', rental_value: '1', organization_id: 'org-1' })
vi.mock('../../services/gig.service', () => ({ getGigKits: vi.fn(), updateGigKitAssignments: vi.fn() }))
vi.mock('../../services/kit.service', () => ({
  getKits: vi.fn().mockResolvedValue([
    { id: 'kit-1', name: 'Test Kit', tag_number: null, category: 'Sound', rental_value: '1', organization_id: 'org-1' },
    { id: 'kit-2', name: 'Another Kit', tag_number: null, category: 'Sound', rental_value: '1', organization_id: 'org-1' },
  ]),
  getKitsFlattenedSummary: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../../services/conflictDetection.service', () => ({
  checkEquipmentConflicts: vi.fn().mockResolvedValue({ conflicts: [], warnings: [] }),
  getEquipmentNeeded: vi.fn(),
}))
vi.mock('../ui/select', () => ({
  Select: ({ onValueChange, disabled, children }: any) => (
    <select aria-label="Assign kit" value="" disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

beforeEach(() => {
  vi.mocked(getGigKits).mockReset().mockResolvedValue([{ id: 'assignment-1', kit_id: 'kit-1', notes: '', kit: kit('kit-1', 'Test Kit') }] as any)
  vi.mocked(updateGigKitAssignments).mockReset().mockImplementation(async (_g, _o, assignments: any[]) =>
    ({ success: true, ids: assignments.map((a) => a.id ?? 'assignment-new') }) as any)
  vi.mocked(getEquipmentNeeded).mockReset().mockResolvedValue({ overlapping: 0, rows: [] } as any)
})

describe('GigKitAssignmentsSection: Equipment needed after a save (A10 characterization)', () => {
  it('reads Equipment needed once, then again after the kits save', async () => {
    renderWithQuery(<GigKitAssignmentsSection gigId="g1" currentOrganizationId="org-1"
      gigStart="2026-10-11T03:00:00Z" gigEnd="2026-10-11T06:00:00Z" gigTimezone="America/Los_Angeles" />)
    await waitFor(() => expect(screen.getByText('Test Kit')).toBeInTheDocument())
    await waitFor(() => expect(getEquipmentNeeded).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Assign kit'), { target: { value: 'kit-2' } })
    await waitFor(() => expect(updateGigKitAssignments).toHaveBeenCalledTimes(1), { timeout: 3000 })
    await waitFor(() => expect(getEquipmentNeeded).toHaveBeenCalledTimes(2))
  })
})
