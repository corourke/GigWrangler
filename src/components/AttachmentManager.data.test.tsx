/** A10 characterization: how a record's attachments load and refresh. */
import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import AttachmentManager from './AttachmentManager'
import { getEntityAttachments, uploadAttachment, linkAttachmentToEntity, unlinkAttachmentFromEntity } from '../services/attachment.service'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../services/attachment.service', () => ({
  uploadAttachment: vi.fn(),
  linkAttachmentToEntity: vi.fn(),
  unlinkAttachmentFromEntity: vi.fn(),
  getEntityAttachments: vi.fn(),
  getAttachmentUrl: vi.fn(),
}))

const file = (id: string, name: string) => ({
  id, entity_attachment_id: `ea-${id}`, file_name: name, file_path: `p/${id}`, file_size: 1, mime_type: 'application/pdf', created_at: '2026-09-28T00:00:00Z',
})
const props = { organizationId: 'org-1', entityType: 'gig' as const, entityId: 'g1' }
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getEntityAttachments).mockReset().mockImplementation(async (_type: string, id: string) => [file(`${id}-a`, `Plot for ${id}.pdf`)] as any)
  vi.mocked(uploadAttachment).mockReset().mockResolvedValue({ id: 'new' } as any)
  vi.mocked(linkAttachmentToEntity).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(unlinkAttachmentFromEntity).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(toast.error).mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('AttachmentManager data (A10 characterization)', () => {
  it('first load: a spinner, then the files', async () => {
    const list = deferred<any>()
    vi.mocked(getEntityAttachments).mockReturnValueOnce(list.promise)
    render(<AttachmentManager {...props} />)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    await act(async () => list.resolve([file('a', 'Stage plot.pdf')]))
    expect(await screen.findByText('Stage plot.pdf')).toBeInTheDocument()
    expect(getEntityAttachments).toHaveBeenCalledWith('gig', 'g1')
  })

  it('a failed load says so and shows none', async () => {
    vi.mocked(getEntityAttachments).mockRejectedValueOnce(new Error('down'))
    render(<AttachmentManager {...props} />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load attachments'))
    expect(await screen.findByText('No attachments found')).toBeInTheDocument()
  })

  it('another record loads its files', async () => {
    const { rerender } = render(<AttachmentManager {...props} />)
    await screen.findByText('Plot for g1.pdf')
    rerender(<AttachmentManager {...props} entityId="g2" />)
    expect(await screen.findByText('Plot for g2.pdf')).toBeInTheDocument()
  })

  // New with A10: the list had no stale-response guard; keying the cache by record adds one.
  it('another record loads its files; a slow earlier answer never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(getEntityAttachments).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<AttachmentManager {...props} />)
    rerender(<AttachmentManager {...props} entityId="g2" />)
    expect(await screen.findByText('Plot for g2.pdf')).toBeInTheDocument()
    await act(async () => slow.resolve([file('x', 'Plot for g1.pdf')]))
    expect(screen.queryByText('Plot for g1.pdf')).not.toBeInTheDocument()
  })

  it('after an upload the list is read again, and the parent is told', async () => {
    const onAttachmentsChange = vi.fn()
    const { container } = render(<AttachmentManager {...props} onAttachmentsChange={onAttachmentsChange} />)
    await screen.findByText('Plot for g1.pdf')
    vi.mocked(getEntityAttachments).mockResolvedValue([file('a', 'Plot for g1.pdf'), file('b', 'Rider.pdf')] as any)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'Rider.pdf')] } })
    expect(await screen.findByText('Rider.pdf')).toBeInTheDocument()
    expect(linkAttachmentToEntity).toHaveBeenCalledWith('new', 'gig', 'g1')
    expect(onAttachmentsChange).toHaveBeenCalled()
  })

  it('after Remove the list is read again, and the parent is told', async () => {
    const onAttachmentsChange = vi.fn()
    render(<AttachmentManager {...props} onAttachmentsChange={onAttachmentsChange} />)
    await screen.findByText('Plot for g1.pdf')
    vi.mocked(getEntityAttachments).mockResolvedValue([] as any)
    fireEvent.click(screen.getByTitle('Remove'))
    expect(await screen.findByText('No attachments found')).toBeInTheDocument()
    expect(unlinkAttachmentFromEntity).toHaveBeenCalledWith('ea-g1-a')
    expect(onAttachmentsChange).toHaveBeenCalled()
  })
})
