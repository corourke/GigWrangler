import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys, invalidateAfterGigKitsChange } from './queryKeys'

// A10 sweep (gig, financials, mobile): keys nest under gig(gigId) and the user's devices.
describe('sweep gig query keys (A10)', () => {
  it('nest under the gig, or the signed-in user', () => {
    expect(queryKeys.gigForm('g1')).toEqual([...queryKeys.gig('g1'), 'form'])
    expect(queryKeys.gigScheduleEntries('g1')).toEqual([...queryKeys.gig('g1'), 'schedule'])
    expect(queryKeys.gigParticipantList('g1')).toEqual([...queryKeys.gig('g1'), 'participantList'])
    expect(queryKeys.gigKits('g1', 'org-1')).toEqual([...queryKeys.gig('g1'), 'kits', 'org-1'])
    expect(queryKeys.enrolledDevice('u1')).toEqual([...queryKeys.myDevices('u1'), 'enrolled'])
    expect(queryKeys.enrolledDevice('u1')).not.toEqual(queryKeys.enrolledDevice('u2'))
  })

  it('Equipment needed is keyed by the gig, its times and the organization, with no reload token', () => {
    const when = { start: 's', end: 'e', timezone: 'UTC', allDay: false }
    expect(queryKeys.gigEquipmentNeeded('g1', 'org-1', when)).toEqual(['gig', 'g1', 'equipmentNeeded', 'org-1', 's', 'e', 'UTC', false])
  })
})

describe('invalidateAfterGigKitsChange (A10)', () => {
  it('refreshes the gig’s Equipment needed, its equipment card and its packing list', async () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    await invalidateAfterGigKitsChange(client, { gigId: 'g1' })
    expect(spy.mock.calls.map((c: any[]) => c[0]?.queryKey)).toEqual(expect.arrayContaining([
      [...queryKeys.gig('g1'), 'equipmentNeeded'],
      [...queryKeys.gig('g1'), 'kits'],
      [...queryKeys.gig('g1'), 'packingList'],
    ]))
  })
})
