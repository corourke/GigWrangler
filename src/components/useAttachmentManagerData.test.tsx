import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../test/renderWithQuery'
import { useAttachmentManagerData } from './useAttachmentManagerData'
import { queryKeys } from '../lib/queryKeys'
import { getEntityAttachments, uploadAttachment, linkAttachmentToEntity, unlinkAttachmentFromEntity } from '../services/attachment.service'

vi.mock('../services/attachment.service', () => ({
  getEntityAttachments: vi.fn(), uploadAttachment: vi.fn(), linkAttachmentToEntity: vi.fn(), unlinkAttachmentFromEntity: vi.fn(),
}))

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useAttachmentManagerData('org-1', 'gig', 'g1'), { wrapper })
  return { client, invalidate, hook }
}

beforeEach(() => {
  vi.mocked(getEntityAttachments).mockReset().mockResolvedValue([{ id: 'a' }] as any)
  vi.mocked(uploadAttachment).mockReset().mockResolvedValue({ id: 'new' } as any)
  vi.mocked(linkAttachmentToEntity).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(unlinkAttachmentFromEntity).mockReset().mockResolvedValue(undefined as any)
})

describe('useAttachmentManagerData (A10)', () => {
  it('caches the record’s attachments under its key, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(client.getQueryData(queryKeys.entityAttachments('gig', 'g1'))).toEqual([{ id: 'a' }])
    expect(client.getQueryCache().find({ queryKey: queryKeys.entityAttachments('gig', 'g1') })!.isStale()).toBe(true)
  })

  it('uploading and removing refresh the record’s attachments', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.upload([new File(['x'], 'a.pdf')]))
    expect(linkAttachmentToEntity).toHaveBeenCalledWith('new', 'gig', 'g1')
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.entityAttachments('gig', 'g1') }))
    invalidate.mockClear()
    await act(() => hook.result.current.remove('ea-1'))
    expect(unlinkAttachmentFromEntity).toHaveBeenCalledWith('ea-1')
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.entityAttachments('gig', 'g1') }))
  })
})
