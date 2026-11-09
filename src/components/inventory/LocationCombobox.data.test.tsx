/** A10 characterization: the place box reads the organization's places once, when first opened. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { LocationCombobox } from './LocationCombobox'
import { getLocationSuggestions } from '../../services/inventoryManagement.service'

vi.mock('../../services/inventoryManagement.service', () => ({ getLocationSuggestions: vi.fn() }))
vi.mock('../ui/popover', () => ({
  Popover: ({ children, open, onOpenChange }: any) => (
    <div>
      <button onClick={() => onOpenChange(!open)}>toggle</button>
      {children}
    </div>
  ),
  PopoverAnchor: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}))

beforeEach(() => {
  vi.mocked(getLocationSuggestions).mockReset().mockResolvedValue(['Truck', 'Warehouse'])
})

describe('LocationCombobox data (A10 characterization)', () => {
  it('reads nothing until opened', async () => {
    render(<LocationCombobox value="" onChange={vi.fn()} organizationId="org-1" />)
    await act(async () => {})
    expect(getLocationSuggestions).not.toHaveBeenCalled()
  })

  it('opening reads the places once; opening again doesn’t read again', async () => {
    render(<LocationCombobox value="" onChange={vi.fn()} organizationId="org-1" />)
    fireEvent.click(screen.getByText('toggle'))
    expect(await screen.findByText('Warehouse')).toBeInTheDocument()
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    await act(async () => {})
    expect(getLocationSuggestions).toHaveBeenCalledTimes(1)
    expect(getLocationSuggestions).toHaveBeenCalledWith('org-1')
  })

  it('typing opens the list and reads the places', async () => {
    const onChange = vi.fn()
    render(<LocationCombobox value="" onChange={onChange} organizationId="org-1" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'T' } })
    await waitFor(() => expect(getLocationSuggestions).toHaveBeenCalledWith('org-1'))
    expect(onChange).toHaveBeenCalledWith('T')
  })

  it('a failed read shows no suggestions', async () => {
    vi.mocked(getLocationSuggestions).mockRejectedValueOnce(new Error('down'))
    render(<LocationCombobox value="" onChange={vi.fn()} organizationId="org-1" />)
    fireEvent.click(screen.getByText('toggle'))
    await waitFor(() => expect(getLocationSuggestions).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText('Warehouse')).not.toBeInTheDocument()
  })
})
