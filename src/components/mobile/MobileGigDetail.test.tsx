import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileGigDetail from './MobileGigDetail'

const mockGig = {
  id: 'gig-1',
  title: 'Summer Festival',
  status: 'Booked',
  start: '2026-07-15T19:00:00Z',
  end: '2026-07-15T23:00:00Z',
  timezone: 'America/New_York',
  tags: ['festival', 'outdoor'],
  notes: 'Load-in at 2pm',
  owner_organization_id: 'org-1',
  participants: [
    { id: 'p1', role: 'Venue', organization: { id: 'org-1', name: 'Madison Square Garden', city: 'New York', state: 'NY', phone_number: '555-1234' } },
    { id: 'p2', role: 'Act', organization: { id: 'org-2', name: 'The Rock Band' } },
  ],
  staff_slots: [
    {
      id: 'slot-1',
      role: 'Sound Engineer',
      count: 1,
      staff_assignments: [
        { id: 'a1', user: { id: 'user-1', first_name: 'John', last_name: 'Doe' }, status: 'Invited' },
      ],
    },
  ],
}

vi.mock('../AttachmentManager', () => ({
  default: ({ allowUpload }: { allowUpload: boolean }) => (
    <div data-testid="attachment-manager" data-allow-upload={String(allowUpload)}>Attachments</div>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../utils/timezones', () => ({
  getAllTimezones: () => ['America/New_York', 'America/Los_Angeles', 'UTC'],
}))

const mockUseAuth = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn(),
  updateGig: vi.fn(),
  updateStaffAssignmentStatus: vi.fn(),
  updateGigParticipants: vi.fn(),
}))

vi.mock('../../services/organization.service', () => ({
  searchOrganizations: vi.fn(),
}))

import { getGig, updateStaffAssignmentStatus, updateGig, updateGigParticipants } from '../../services/gig.service'
import { searchOrganizations } from '../../services/organization.service'
import { makeOrganization } from '../../test/factories'
import { toast } from 'sonner'



describe('MobileGigDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getGig).mockResolvedValue(mockGig as unknown as Awaited<ReturnType<typeof getGig>>)
    vi.mocked(updateGig).mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof updateGig>>)
    vi.mocked(updateGigParticipants).mockResolvedValue({ success: true, ids: [] })
    vi.mocked(searchOrganizations).mockResolvedValue([])
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      userRole: 'Staff',
      selectedOrganization: { id: 'org-1' },
    })
  })

  // Plan #445 (A1): the day sheet for any gig, from its page.
  for (const role of ['Staff', 'Admin', 'Manager']) {
    it(`offers the Day sheet to ${role}`, async () => {
      mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: role, selectedOrganization: { id: 'org-1' } })
      const onViewDaySheet = vi.fn()
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} onViewDaySheet={onViewDaySheet} />)
      await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Day sheet' }))
      expect(onViewDaySheet).toHaveBeenCalledWith('gig-1')
    })
  }

  it("doesn't offer the Day sheet to a Viewer", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: 'Viewer', selectedOrganization: { id: 'org-1' } })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} onViewDaySheet={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Day sheet' })).not.toBeInTheDocument()
  })

  it('renders gig title and status', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    })
    expect(screen.getByText('Booked')).toBeInTheDocument()
  })

  it('does not render venue or act detail rows in the info card', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    })
    expect(screen.queryByText('New York, NY')).not.toBeInTheDocument()
    expect(screen.queryByText('Date & Time')).toBeInTheDocument()
  })

  it('shows accept/decline buttons for invited staff assignment', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getAllByText('Accept').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getAllByText('Decline').length).toBeGreaterThanOrEqual(1)
  })

  it('calls updateStaffAssignmentStatus on accept', async () => {
    vi.mocked(updateStaffAssignmentStatus).mockResolvedValue(undefined)
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getAllByText('Accept').length).toBeGreaterThanOrEqual(1)
    })

    fireEvent.click(screen.getAllByText('Accept')[0])

    await waitFor(() => {
      expect(updateStaffAssignmentStatus).toHaveBeenCalledWith('a1', 'Confirmed')
    })
  })

  it('renders notes within main card', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Load-in at 2pm')).toBeInTheDocument()
    })
  })

  it('renders tags within main card', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('festival')).toBeInTheDocument()
    })
    expect(screen.getByText('outdoor')).toBeInTheDocument()
  })

  it('renders packing list and call venue buttons (no standalone directions)', async () => {
    const onViewPackingList = vi.fn()
    render(<MobileGigDetail gigId="gig-1" onBack={onViewPackingList} onViewPackingList={onViewPackingList} />)

    await waitFor(() => {
      expect(screen.getByText('Packing List')).toBeInTheDocument()
    })
    expect(screen.getByText('Call Venue')).toBeInTheDocument()
    expect(screen.queryByText('Directions')).not.toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn()
    render(<MobileGigDetail gigId="gig-1" onBack={onBack} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    })

    const backButtons = screen.getAllByRole('button')
    fireEvent.click(backButtons[0])
    expect(onBack).toHaveBeenCalled()
  })

  it('shows status change options when status badge is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: 'Manager', selectedOrganization: { id: 'org-1' } })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Booked'))

    await waitFor(() => {
      expect(screen.getByText('Date Hold')).toBeInTheDocument()
      expect(screen.getByText('Proposed')).toBeInTheDocument()
    })
  })

  // Mobile receipt capture (11-10): a receipt captured here is a cost of this gig.
  it.each([['Manager', true], ['Staff', false]])('%s sees Capture receipt for this gig: %s', async (role, shown) => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: role, selectedOrganization: { id: 'org-1' } })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
    expect(!!screen.queryByRole('button', { name: 'Capture receipt for this gig' })).toBe(shown)
  })

  // #175: the status is the gig owner's Admins' and Managers' to change.
  it.each([
    ["the owner's Staff", 'Staff', 'org-1'],
    ["another participant's Admin", 'Admin', 'org-2'],
  ])("doesn't let %s change the status", async (_who, role, orgId) => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: role, selectedOrganization: { id: orgId } })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Booked'))

    expect(screen.queryByText('Date Hold')).not.toBeInTheDocument()
  })

  // #175: an organization Inactive on the gig is read-only on its shared details.
  it('tells an Inactive organization so, and offers no edit', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: 'Admin', selectedOrganization: { id: 'org-2', name: 'The Rock Band' } })
    vi.mocked(getGig).mockResolvedValue({
      ...mockGig,
      participants: [mockGig.participants[0], { ...mockGig.participants[1], organization_id: 'org-2', inactive: true }],
    } as unknown as Awaited<ReturnType<typeof getGig>>)
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    expect(await screen.findByText('The Rock Band is Inactive on this gig: it is being removed. Its financial records and notes are kept; everything else is read-only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit gig/i })).not.toBeInTheDocument()
  })

  it('renders Participants section heading instead of Organizations', async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Participants')).toBeInTheDocument()
    })
    expect(screen.queryByText('Organizations')).not.toBeInTheDocument()
  })

  it('renders AttachmentManager with allowUpload=false for Staff role', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      userRole: 'Staff',
      selectedOrganization: { id: 'org-1' },
    })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('attachment-manager')).toBeInTheDocument()
    })
    expect(screen.getByTestId('attachment-manager')).toHaveAttribute('data-allow-upload', 'false')
  })

  it('renders AttachmentManager with allowUpload=true for Admin role', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      userRole: 'Admin',
      selectedOrganization: { id: 'org-1' },
    })
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('attachment-manager')).toBeInTheDocument()
    })
    expect(screen.getByTestId('attachment-manager')).toHaveAttribute('data-allow-upload', 'true')
  })

  describe('inline edit mode', () => {
    it('shows edit button for Admin role', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      const editButton = screen.getByRole('button', { name: /edit gig/i })
      expect(editButton).toBeInTheDocument()
    })

    it('shows edit button for Manager role', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Manager',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      expect(screen.getByRole('button', { name: /edit gig/i })).toBeInTheDocument()
    })

    it('does not show edit button for Staff role', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Staff',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /edit gig/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Save')).not.toBeInTheDocument()
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    })

    it('keeps the date and time fields inside the screen width when editing (#442)', async () => {
      mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: 'Admin', selectedOrganization: { id: 'org-1' } })
      const { container } = render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))
      await waitFor(() => expect(screen.getByPlaceholderText('Gig title')).toBeInTheDocument())
      const fields = container.querySelectorAll('input[type=date], input[type=time]')
      expect(fields.length).toBeGreaterThan(0)
      for (const input of fields) {
        expect(input.className).toContain('min-w-0')
        expect(input.parentElement!.className).toContain('min-w-0')
      }
    })

    it('clicking Edit shows title input, date input, textarea for notes, timezone select', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      const editButton = screen.getByRole('button', { name: /edit gig/i })
      fireEvent.click(editButton)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Gig title')).toBeInTheDocument()
      })
      expect(screen.getByPlaceholderText('Notes…')).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()

      const selects = screen.getAllByRole('combobox')
      expect(selects.some(s => s.querySelector('option[value="America/New_York"]') !== null || Array.from((s as HTMLSelectElement).options || []).some((o: any) => o.value === 'America/New_York'))).toBe(true)
    })

    it('title input is pre-populated with current gig title', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        const titleInput = screen.getByPlaceholderText('Gig title') as HTMLInputElement
        expect(titleInput.value).toBe('Summer Festival')
      })
    })

    it('clicking Cancel returns to view mode without calling updateGig', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Gig title')).not.toBeInTheDocument()
      })

      expect(updateGig).not.toHaveBeenCalled()
    })

    it('clicking Save calls updateGig and updateGigParticipants', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1', name: 'Org One' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Gig title')).toBeInTheDocument()
      })

      const titleInput = screen.getByPlaceholderText('Gig title')
      fireEvent.change(titleInput, { target: { value: 'Updated Festival' } })

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(updateGig).toHaveBeenCalledWith('gig-1', expect.objectContaining({
          title: 'Updated Festival',
        }))
      })

      await waitFor(() => {
        // History is logged against the org the user is working as (#103).
        expect(updateGigParticipants).toHaveBeenCalledWith('gig-1', expect.any(Array), { organization_id: 'org-1', actor_org_name: 'Org One' }, ['p1', 'p2'], expect.any(Array))
      })
    })

    it('passes the participants it loaded, so only a removed one is deleted (#92)', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1', name: 'Org One' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))
      await waitFor(() => expect(screen.getByPlaceholderText('Gig title')).toBeInTheDocument())

      // The gig gained a participant elsewhere after this screen loaded it.
      vi.mocked(getGig).mockResolvedValue({
        ...mockGig,
        participants: [...mockGig.participants, { id: 'p3', role: 'Production', organization: { id: 'org-3', name: 'Other Co' } }],
      } as unknown as Awaited<ReturnType<typeof getGig>>)
      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(updateGigParticipants).toHaveBeenCalled())
      expect(vi.mocked(updateGigParticipants).mock.calls[0][3]).toEqual(['p1', 'p2'])
      // …and their values as loaded, so only what the user changed is written (coordinator follow-up).
      expect(vi.mocked(updateGigParticipants).mock.calls[0][4]).toEqual([
        { id: 'p1', role: 'Venue', notes: null, is_client: false },
        { id: 'p2', role: 'Act', notes: null, is_client: false },
      ])
    })

    // #175: the save used to send only id, organization and role, and the service writes
    // notes and the client flag from what it's sent, so every mobile edit cleared them.
    it("keeps each participant's notes and client flag when saving", async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1', name: 'Org One' },
      })
      vi.mocked(getGig).mockResolvedValue({
        ...mockGig,
        participants: [
          { ...mockGig.participants[0], organization_id: 'org-1', notes: 'Dock B', is_client: true },
          { ...mockGig.participants[1], organization_id: 'org-2', notes: null, is_client: false },
        ],
      } as unknown as Awaited<ReturnType<typeof getGig>>)
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('Summer Festival')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))
      await waitFor(() => expect(screen.getByPlaceholderText('Gig title')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(updateGigParticipants).toHaveBeenCalled())
      expect(vi.mocked(updateGigParticipants).mock.calls[0][1]).toEqual([
        expect.objectContaining({ id: 'p1', notes: 'Dock B', is_client: true }),
        expect.objectContaining({ id: 'p2', notes: null, is_client: false }),
      ])
    })

    it('shows toast error and stays in edit mode when updateGig rejects', async () => {
      vi.mocked(updateGig).mockRejectedValue(new Error('Server error'))
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Save'))
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server error')
      })

      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('saves a single-day all-day gig without the end<=start error (regression for #10)', async () => {
      vi.mocked(getGig).mockResolvedValue({
        ...mockGig,
        start: '2026-07-15T12:00:00.000Z',
        end: '2026-07-15T12:00:00.000Z',
      } as unknown as Awaited<ReturnType<typeof getGig>>)
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument()
      })

      await act(async () => {
        fireEvent.click(screen.getByText('Save'))
      })

      await waitFor(() => {
        expect(updateGig).toHaveBeenCalledWith('gig-1', expect.objectContaining({
          title: 'Summer Festival',
        }))
      })

      expect(toast.error).not.toHaveBeenCalledWith('End date/time must be after start date/time')
    })

    it('participant X button removes participant from edit list', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'different-org' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByText('Madison Square Garden')).toBeInTheDocument()
      })

      expect(screen.getByText('The Rock Band')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /remove madison square garden/i }))

      await waitFor(() => {
        expect(screen.queryByText('Madison Square Garden')).not.toBeInTheDocument()
      })

      expect(screen.getByText('The Rock Band')).toBeInTheDocument()
    })

    it('add participant flow: search, select org, choose role, confirm adds to list', async () => {
      vi.mocked(searchOrganizations).mockResolvedValue([
        makeOrganization({ id: 'org-99', name: 'New Venue' }),
      ])
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        userRole: 'Admin',
        selectedOrganization: { id: 'org-1' },
      })
      render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('Summer Festival')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))

      await waitFor(() => {
        expect(screen.getByText('Add Participant')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add Participant'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search organizations…')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Search organizations…'), { target: { value: 'New' } })

      await waitFor(() => {
        expect(searchOrganizations).toHaveBeenCalledWith({ search: 'New' })
      }, { timeout: 1000 })

      await waitFor(() => {
        expect(screen.getByText('New Venue')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('New Venue'))

      fireEvent.click(screen.getByText('Select role…'))

      await waitFor(() => {
        expect(screen.getByText('Sound Company')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sound Company'))

      fireEvent.click(screen.getByText('Add'))

      await waitFor(() => {
        expect(screen.getByText('New Venue')).toBeInTheDocument()
      })

      expect(screen.queryByPlaceholderText('Search organizations…')).not.toBeInTheDocument()
    })
  })
})

// A10 characterization: the add-participant organization search.
describe('MobileGigDetail: organization search (A10 characterization)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getGig).mockResolvedValue(mockGig as unknown as Awaited<ReturnType<typeof getGig>>)
    vi.mocked(searchOrganizations).mockImplementation(async (f: any) => [
      makeOrganization({ id: `o-${f.search}-${f.type ?? 'any'}`, name: `${f.search} (${f.type ?? 'any'})` }),
    ])
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, userRole: 'Admin', selectedOrganization: { id: 'org-1' } })
  })

  const openSearch = async () => {
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await screen.findByText('Summer Festival')
    fireEvent.click(screen.getByRole('button', { name: /edit gig/i }))
    fireEvent.click(await screen.findByText('Add Participant'))
    return screen.findByPlaceholderText('Search organizations…')
  }

  it('searches what was typed, then again by type once a role is picked', async () => {
    const box = await openSearch()
    fireEvent.change(box, { target: { value: 'Hall' } })
    expect(await screen.findByText('Hall (any)', {}, { timeout: 1000 })).toBeInTheDocument()
    expect(searchOrganizations).toHaveBeenCalledWith({ search: 'Hall' })
    fireEvent.click(screen.getByText('Select role…'))
    fireEvent.click((await screen.findAllByText('Venue')).find((el) => el.tagName === 'LI')!)
    expect(await screen.findByText('Hall (Venue)', {}, { timeout: 1000 })).toBeInTheDocument()
    expect(searchOrganizations).toHaveBeenCalledWith({ search: 'Hall', type: 'Venue' })
  })

  it('clearing the box clears the results', async () => {
    const box = await openSearch()
    fireEvent.change(box, { target: { value: 'Hall' } })
    expect(await screen.findByText('Hall (any)', {}, { timeout: 1000 })).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '' } })
    await waitFor(() => expect(screen.queryByText('Hall (any)')).not.toBeInTheDocument())
  })
})
