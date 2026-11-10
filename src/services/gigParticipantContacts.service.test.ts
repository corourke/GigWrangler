import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getGigParticipantContacts,
  getAllGigContacts,
  addGigParticipantContact,
  setGigParticipantContactPrimary,
  removeGigParticipantContact,
  createContactPerson,
} from './gigParticipantContacts.service';
import { createClient } from '../utils/supabase/client';

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('gigParticipantContacts.service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };

    (createClient as any).mockReturnValue(mockSupabase);
  });

  describe('getGigParticipantContacts', () => {
    it('queries by gig_id and organization_id, primary first', async () => {
      const mockRows = [
        { id: 'gpc-1', gig_id: 'gig-1', organization_id: 'org-1', user_id: 'u1', is_primary_contact: true, title: null, created_at: '2026-01-01', user: { id: 'u1', first_name: 'Jane', last_name: 'Doe', email: null, phone: null } },
      ];
      const order2 = vi.fn().mockResolvedValue({ data: mockRows, error: null });
      const order1 = vi.fn().mockReturnValue({ order: order2 });
      const eq2 = vi.fn().mockReturnValue({ order: order1 });
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
      const select = vi.fn().mockReturnValue({ eq: eq1 });
      mockSupabase.from.mockReturnValue({ select });

      const result = await getGigParticipantContacts('gig-1', 'org-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('gig_participant_contacts');
      expect(eq1).toHaveBeenCalledWith('gig_id', 'gig-1');
      expect(eq2).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(result).toEqual(mockRows);
    });
  });

  describe('getAllGigContacts', () => {
    it("queries every organization's contacts on the gig, primary first", async () => {
      const mockRows = [{ id: 'gpc-1', gig_id: 'gig-1', organization_id: 'org-1' }];
      const order2 = vi.fn().mockResolvedValue({ data: mockRows, error: null });
      const order1 = vi.fn().mockReturnValue({ order: order2 });
      const eq1 = vi.fn().mockReturnValue({ order: order1 });
      const select = vi.fn().mockReturnValue({ eq: eq1 });
      mockSupabase.from.mockReturnValue({ select });

      const result = await getAllGigContacts('gig-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('gig_participant_contacts');
      expect(eq1).toHaveBeenCalledTimes(1);
      expect(eq1).toHaveBeenCalledWith('gig_id', 'gig-1');
      expect(order1).toHaveBeenCalledWith('is_primary_contact', { ascending: false });
      expect(result).toEqual(mockRows);
    });
  });

  describe('addGigParticipantContact', () => {
    it('upserts via the RPC — re-adding an existing link is not expected to error', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: { id: 'gpc-1', user_id: 'u1' }, error: null });

      await addGigParticipantContact('gig-1', 'org-1', { userId: 'u1', isPrimary: true, title: 'Day-of contact' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('add_gig_participant_contact', {
        p_gig_id: 'gig-1',
        p_organization_id: 'org-1',
        p_user_id: 'u1',
        p_is_primary: true,
        p_title: 'Day-of contact',
      });
    });
  });

  describe('setGigParticipantContactPrimary', () => {
    it('toggles the per-gig primary flag independent of any org-wide setting', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      await setGigParticipantContactPrimary('gig-1', 'org-1', 'u1', false);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('set_gig_participant_contact_primary', {
        p_gig_id: 'gig-1',
        p_organization_id: 'org-1',
        p_user_id: 'u1',
        p_is_primary: false,
      });
    });
  });

  describe('removeGigParticipantContact', () => {
    it('removes only the gig-contact link', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

      await removeGigParticipantContact('gig-1', 'org-1', 'u1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('remove_gig_participant_contact', {
        p_gig_id: 'gig-1',
        p_organization_id: 'org-1',
        p_user_id: 'u1',
      });
    });
  });

  describe('createContactPerson', () => {
    it('creates a bare person not tied to any organization', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 'new-user-id', error: null });

      const result = await createContactPerson({ firstName: 'Jane', lastName: 'Doe' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('create_contact_person', {
        p_first_name: 'Jane',
        p_last_name: 'Doe',
        p_email: undefined,
        p_phone: undefined,
      });
      expect(result).toBe('new-user-id');
    });
  });
});
