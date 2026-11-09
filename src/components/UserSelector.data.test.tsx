/** Characterization tests (A10): UserSelector's search. */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../test/renderWithQuery';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import UserSelector from './UserSelector';
import { searchUsers } from '../services/user.service';

vi.mock('../services/user.service', () => ({ searchUsers: vi.fn() }));
vi.mock('./organization/AddPersonDialog', () => ({ default: () => null }));

const person = (id: string, first: string) => ({ id, first_name: first, last_name: 'Tester', email: `${id}@example.com` }) as any;
const type = (value: string) => {
  const input = screen.getByPlaceholderText('Search for user...');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
};

beforeEach(() => vi.clearAllMocks());

describe('UserSelector: search', () => {
  it('searches within the given organizations and lists the people found', async () => {
    vi.mocked(searchUsers).mockResolvedValue([person('p1', 'Avery')]);
    render(<UserSelector onSelect={vi.fn()} organizationIds={['org-1']} />);
    type('av');
    expect(await screen.findByText('Avery Tester')).toBeInTheDocument();
    expect(screen.getByText('Found 1 result')).toBeInTheDocument();
    expect(searchUsers).toHaveBeenCalledWith('av', ['org-1']);
  });

  it('shows a searching state while waiting', async () => {
    vi.mocked(searchUsers).mockReturnValue(new Promise(() => {}));
    render(<UserSelector onSelect={vi.fn()} />);
    type('av');
    expect(await screen.findByText('Searching...')).toBeInTheDocument();
  });

  it('says no users found when the search fails', async () => {
    vi.mocked(searchUsers).mockRejectedValue(new Error('offline'));
    render(<UserSelector onSelect={vi.fn()} />);
    type('av');
    expect(await screen.findByText('No users found')).toBeInTheDocument();
  });

  it('a new search replaces the old results', async () => {
    vi.mocked(searchUsers).mockImplementation(async (q?: string) => (q === 'av' ? [person('p1', 'Avery')] : [person('p2', 'Blake')]));
    render(<UserSelector onSelect={vi.fn()} />);
    type('av');
    expect(await screen.findByText('Avery Tester')).toBeInTheDocument();
    type('bl');
    expect(await screen.findByText('Blake Tester')).toBeInTheDocument();
    expect(screen.queryByText('Avery Tester')).not.toBeInTheDocument();
  });

  it('picking a person selects them and clears the search', async () => {
    vi.mocked(searchUsers).mockResolvedValue([person('p1', 'Avery')]);
    const onSelect = vi.fn();
    render(<UserSelector onSelect={onSelect} />);
    type('av');
    fireEvent.mouseDown(await screen.findByText('Avery Tester'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Search for user...')).toHaveValue(''));
  });
});
