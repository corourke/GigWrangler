export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          message: string | null
          organization_id: string
          requested_role: Database["public"]["Enums"]["user_role"]
          requester_id: string
          response_message: string | null
          status: string
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          message?: string | null
          organization_id: string
          requested_role: Database["public"]["Enums"]["user_role"]
          requester_id: string
          response_message?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          message?: string | null
          organization_id?: string
          requested_role?: Database["public"]["Enums"]["user_role"]
          requester_id?: string
          response_message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          actor_id: string | null
          context: Json
          entity_id: string
          entity_type: string
          event_type: string
          gig_id: string | null
          id: string
          occurred_at: string
          organization_id: string | null
        }
        Insert: {
          actor_id?: string | null
          context?: Json
          entity_id: string
          entity_type: string
          event_type: string
          gig_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string | null
        }
        Update: {
          actor_id?: string | null
          context?: Json
          entity_id?: string
          entity_type?: string
          event_type?: string
          gig_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_scan_usage: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          acquisition_date: string
          category: string
          created_at: string
          created_by: string
          description: string | null
          equipment_item_id: string
          id: string
          insurance_class: string | null
          insurance_policy_added: boolean
          item_cost: number | null
          item_price: number | null
          liquidation_amt: number | null
          maintenance_by: string | null
          maintenance_expected_back: string | null
          maintenance_from: string | null
          maintenance_location: string | null
          maintenance_notes: string | null
          maintenance_pending: boolean
          maintenance_pending_gig_id: string | null
          maintenance_pending_quantity: number | null
          maintenance_since: string | null
          manufacturer_model: string
          organization_id: string
          purchase_id: string | null
          purchase_line_id: string | null
          quantity: number | null
          recovery_period: number | null
          replacement_value: number | null
          retired_on: string | null
          serial_number: string | null
          status: string
          status_before_maintenance: string | null
          status_before_write_off: string | null
          tag_number: string | null
          type: string | null
          updated_at: string
          updated_by: string
          vendor: string | null
          written_off_from: string | null
        }
        Insert: {
          acquisition_date: string
          category: string
          created_at?: string
          created_by: string
          description?: string | null
          equipment_item_id?: string
          id?: string
          insurance_class?: string | null
          insurance_policy_added?: boolean
          item_cost?: number | null
          item_price?: number | null
          liquidation_amt?: number | null
          maintenance_by?: string | null
          maintenance_expected_back?: string | null
          maintenance_from?: string | null
          maintenance_location?: string | null
          maintenance_notes?: string | null
          maintenance_pending?: boolean
          maintenance_pending_gig_id?: string | null
          maintenance_pending_quantity?: number | null
          maintenance_since?: string | null
          manufacturer_model: string
          organization_id: string
          purchase_id?: string | null
          purchase_line_id?: string | null
          quantity?: number | null
          recovery_period?: number | null
          replacement_value?: number | null
          retired_on?: string | null
          serial_number?: string | null
          status?: string
          status_before_maintenance?: string | null
          status_before_write_off?: string | null
          tag_number?: string | null
          type?: string | null
          updated_at?: string
          updated_by: string
          vendor?: string | null
          written_off_from?: string | null
        }
        Update: {
          acquisition_date?: string
          category?: string
          created_at?: string
          created_by?: string
          description?: string | null
          equipment_item_id?: string
          id?: string
          insurance_class?: string | null
          insurance_policy_added?: boolean
          item_cost?: number | null
          item_price?: number | null
          liquidation_amt?: number | null
          maintenance_by?: string | null
          maintenance_expected_back?: string | null
          maintenance_from?: string | null
          maintenance_location?: string | null
          maintenance_notes?: string | null
          maintenance_pending?: boolean
          maintenance_pending_gig_id?: string | null
          maintenance_pending_quantity?: number | null
          maintenance_since?: string | null
          manufacturer_model?: string
          organization_id?: string
          purchase_id?: string | null
          purchase_line_id?: string | null
          quantity?: number | null
          recovery_period?: number | null
          replacement_value?: number | null
          retired_on?: string | null
          serial_number?: string | null
          status?: string
          status_before_maintenance?: string | null
          status_before_write_off?: string | null
          tag_number?: string | null
          type?: string | null
          updated_at?: string
          updated_by?: string
          vendor?: string | null
          written_off_from?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_maintenance_by_fkey"
            columns: ["maintenance_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_maintenance_from_fkey"
            columns: ["maintenance_from"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_maintenance_pending_gig_id_fkey"
            columns: ["maintenance_pending_gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_purchase_line_id_fkey"
            columns: ["purchase_line_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_written_off_from_fkey"
            columns: ["written_off_from"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string
          file_path: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name: string
          file_path: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_path?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_attachments: {
        Row: {
          attachment_id: string
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          attachment_id: string
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          attachment_id?: string
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_attachments_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_categories: {
        Row: {
          active: boolean
          created_at: string
          default_recovery_period: number | null
          id: string
          name: string
          organization_id: string | null
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_recovery_period?: number | null
          id?: string
          name: string
          organization_id?: string | null
          sort_order: number
        }
        Update: {
          active?: boolean
          created_at?: string
          default_recovery_period?: number | null
          id?: string
          name?: string
          organization_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "equipment_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_items: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          insurance_class: string | null
          manufacturer_model: string
          organization_id: string
          type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          insurance_class?: string | null
          manufacturer_model: string
          organization_id: string
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          insurance_class?: string | null
          manufacturer_model?: string
          organization_id?: string
          type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string | null
          schedule_c_line: string | null
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          schedule_c_line?: string | null
          sort_order: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          schedule_c_line?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_schedule_c_line_fkey"
            columns: ["schedule_c_line"]
            isOneToOne: false
            referencedRelation: "schedule_c_lines"
            referencedColumns: ["code"]
          },
        ]
      }
      gig_financials: {
        Row: {
          amount: number | null
          amount_settled: number | null
          category: Database["public"]["Enums"]["fin_category"] | null
          counterparty_id: string | null
          created_at: string
          created_by: string
          currency: string
          date: string
          description: string | null
          direction: Database["public"]["Enums"]["fin_direction"]
          due_date: string | null
          external_entity_name: string | null
          gig_id: string
          id: string
          legacy_type: Database["public"]["Enums"]["fin_type"] | null
          mileage: number | null
          notes: string | null
          organization_id: string | null
          paid_at: string | null
          purchase_id: string | null
          reference_number: string | null
          staff_assignment_id: string | null
          stage: Database["public"]["Enums"]["fin_stage"]
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          amount?: number | null
          amount_settled?: number | null
          category?: Database["public"]["Enums"]["fin_category"] | null
          counterparty_id?: string | null
          created_at?: string
          created_by: string
          currency?: string
          date: string
          description?: string | null
          direction: Database["public"]["Enums"]["fin_direction"]
          due_date?: string | null
          external_entity_name?: string | null
          gig_id: string
          id?: string
          legacy_type?: Database["public"]["Enums"]["fin_type"] | null
          mileage?: number | null
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          purchase_id?: string | null
          reference_number?: string | null
          staff_assignment_id?: string | null
          stage: Database["public"]["Enums"]["fin_stage"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          amount?: number | null
          amount_settled?: number | null
          category?: Database["public"]["Enums"]["fin_category"] | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          date?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["fin_direction"]
          due_date?: string | null
          external_entity_name?: string | null
          gig_id?: string
          id?: string
          legacy_type?: Database["public"]["Enums"]["fin_type"] | null
          mileage?: number | null
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          purchase_id?: string | null
          reference_number?: string | null
          staff_assignment_id?: string | null
          stage?: Database["public"]["Enums"]["fin_stage"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gig_bids_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_bids_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_financials_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_financials_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_financials_staff_assignment_id_fkey"
            columns: ["staff_assignment_id"]
            isOneToOne: false
            referencedRelation: "gig_staff_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_financials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_kit_assignments: {
        Row: {
          added_at_pack_out: boolean
          assigned_at: string
          assigned_by: string
          gig_id: string
          id: string
          kit_id: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          added_at_pack_out?: boolean
          assigned_at?: string
          assigned_by: string
          gig_id: string
          id?: string
          kit_id: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          added_at_pack_out?: boolean
          assigned_at?: string
          assigned_by?: string
          gig_id?: string
          id?: string
          kit_id?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_kit_assignments_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_kit_assignments_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_kit_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_participant_contacts: {
        Row: {
          created_at: string
          gig_id: string
          id: string
          is_primary_contact: boolean
          organization_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          gig_id: string
          id?: string
          is_primary_contact?: boolean
          organization_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          gig_id?: string
          id?: string
          is_primary_contact?: boolean
          organization_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_participant_contacts_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_participant_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_participant_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_participants: {
        Row: {
          gig_id: string
          id: string
          inactive: boolean
          is_client: boolean
          notes: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
        }
        Insert: {
          gig_id: string
          id?: string
          inactive?: boolean
          is_client?: boolean
          notes?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
        }
        Update: {
          gig_id?: string
          id?: string
          inactive?: boolean
          is_client?: boolean
          notes?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
        }
        Relationships: [
          {
            foreignKeyName: "gig_participants_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_schedule_entries: {
        Row: {
          act_participant_id: string | null
          activity_type: string
          created_at: string
          end_time: string | null
          gig_id: string
          id: string
          label: string | null
          notes: string | null
          sort_order: number
          start_time: string
          updated_at: string
        }
        Insert: {
          act_participant_id?: string | null
          activity_type: string
          created_at?: string
          end_time?: string | null
          gig_id: string
          id?: string
          label?: string | null
          notes?: string | null
          sort_order?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          act_participant_id?: string | null
          activity_type?: string
          created_at?: string
          end_time?: string | null
          gig_id?: string
          id?: string
          label?: string | null
          notes?: string | null
          sort_order?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_schedule_entries_act_participant_id_fkey"
            columns: ["act_participant_id"]
            isOneToOne: false
            referencedRelation: "gig_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_schedule_entries_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_staff_assignments: {
        Row: {
          assigned_at: string
          completed_at: string | null
          confirmed_at: string | null
          fee: number | null
          gig_financial_id: string | null
          id: string
          notes: string | null
          rate: number | null
          rate_unit: string
          slot_id: string
          status: string
          units_completed: number | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          completed_at?: string | null
          confirmed_at?: string | null
          fee?: number | null
          gig_financial_id?: string | null
          id?: string
          notes?: string | null
          rate?: number | null
          rate_unit?: string
          slot_id: string
          status: string
          units_completed?: number | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          completed_at?: string | null
          confirmed_at?: string | null
          fee?: number | null
          gig_financial_id?: string | null
          id?: string
          notes?: string | null
          rate?: number | null
          rate_unit?: string
          slot_id?: string
          status?: string
          units_completed?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_staff_assignments_gig_financial_id_fkey"
            columns: ["gig_financial_id"]
            isOneToOne: false
            referencedRelation: "gig_financials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_staff_assignments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "gig_staff_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_staff_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_staff_slots: {
        Row: {
          created_at: string
          gig_id: string
          id: string
          notes: string | null
          organization_id: string
          required_count: number
          staff_role_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gig_id: string
          id?: string
          notes?: string | null
          organization_id: string
          required_count?: number
          staff_role_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gig_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          required_count?: number
          staff_role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_staff_slots_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_staff_slots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_staff_slots_staff_role_id_fkey"
            columns: ["staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      gig_sync_status: {
        Row: {
          created_at: string
          gig_id: string
          google_event_id: string | null
          id: string
          last_synced_at: string | null
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gig_id: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gig_id?: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gig_sync_status_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gig_sync_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gigs: {
        Row: {
          created_at: string
          created_by: string
          end: string
          hierarchy_depth: number
          id: string
          notes: string | null
          owner_organization_id: string
          parent_gig_id: string | null
          start: string
          status: Database["public"]["Enums"]["gig_status"]
          tags: string[] | null
          timezone: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          end: string
          hierarchy_depth?: number
          id?: string
          notes?: string | null
          owner_organization_id: string
          parent_gig_id?: string | null
          start: string
          status: Database["public"]["Enums"]["gig_status"]
          tags?: string[] | null
          timezone: string
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          end?: string
          hierarchy_depth?: number
          id?: string
          notes?: string | null
          owner_organization_id?: string
          parent_gig_id?: string | null
          start?: string
          status?: Database["public"]["Enums"]["gig_status"]
          tags?: string[] | null
          timezone?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "gigs_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gigs_parent_gig_id_fkey"
            columns: ["parent_gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_tracking: {
        Row: {
          asset_id: string | null
          created_at: string
          gig_id: string
          id: string
          kit_id: string | null
          location: string | null
          notes: string | null
          organization_id: string
          quantity: number
          scanned_at: string
          scanned_by: string | null
          status: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          gig_id: string
          id?: string
          kit_id?: string | null
          location?: string | null
          notes?: string | null
          organization_id: string
          quantity?: number
          scanned_at?: string
          scanned_by?: string | null
          status: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          gig_id?: string
          id?: string
          kit_id?: string | null
          location?: string | null
          notes?: string | null
          organization_id?: string
          quantity?: number
          scanned_at?: string
          scanned_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_tracking_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tracking_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tracking_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tracking_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token: string
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          status?: string
          token: string
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kit_components: {
        Row: {
          asset_id: string | null
          child_kit_id: string | null
          created_at: string
          equipment_item_id: string | null
          id: string
          kit_id: string
          notes: string | null
          quantity: number
        }
        Insert: {
          asset_id?: string | null
          child_kit_id?: string | null
          created_at?: string
          equipment_item_id?: string | null
          id?: string
          kit_id: string
          notes?: string | null
          quantity?: number
        }
        Update: {
          asset_id?: string | null
          child_kit_id?: string | null
          created_at?: string
          equipment_item_id?: string | null
          id?: string
          kit_id?: string
          notes?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "kit_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_assets_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_components_child_kit_id_fkey"
            columns: ["child_kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_components_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
        ]
      }
      kit_flattened_cache: {
        Row: {
          asset_id: string
          kit_id: string
          total_quantity: number
          updated_at: string
        }
        Insert: {
          asset_id: string
          kit_id: string
          total_quantity: number
          updated_at?: string
        }
        Update: {
          asset_id?: string
          kit_id?: string
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kit_flattened_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_flattened_cache_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
        ]
      }
      kit_flattened_item_cache: {
        Row: {
          equipment_item_id: string
          kit_id: string
          total_quantity: number
          updated_at: string
        }
        Insert: {
          equipment_item_id: string
          kit_id: string
          total_quantity: number
          updated_at?: string
        }
        Update: {
          equipment_item_id?: string
          kit_id?: string
          total_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kit_flattened_item_cache_equipment_item_id_fkey"
            columns: ["equipment_item_id"]
            isOneToOne: false
            referencedRelation: "equipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_flattened_item_cache_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
        ]
      }
      kits: {
        Row: {
          category: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_container: boolean
          name: string
          organization_id: string
          rental_value: number | null
          tag_number: string | null
          tags: string[] | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_container?: boolean
          name: string
          organization_id: string
          rental_value?: number | null
          tag_number?: string | null
          tags?: string[] | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_container?: boolean
          name?: string
          organization_id?: string
          rental_value?: number | null
          tag_number?: string | null
          tags?: string[] | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "kits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kv_store_de012ad4: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          contact_title: string | null
          created_at: string
          default_staff_role_id: string | null
          id: string
          is_primary_contact: boolean
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          contact_title?: string | null
          created_at?: string
          default_staff_role_id?: string | null
          id?: string
          is_primary_contact?: boolean
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          contact_title?: string | null
          created_at?: string
          default_staff_role_id?: string | null
          id?: string
          is_primary_contact?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_default_staff_role_id_fkey"
            columns: ["default_staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          allowed_domains: string | null
          city: string | null
          claimed: boolean
          country: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          phone_number: string | null
          postal_code: string | null
          roles: Database["public"]["Enums"]["organization_role"][]
          state: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          allowed_domains?: string | null
          city?: string | null
          claimed?: boolean
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          phone_number?: string | null
          postal_code?: string | null
          roles: Database["public"]["Enums"]["organization_role"][]
          state?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          allowed_domains?: string | null
          city?: string | null
          claimed?: boolean
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          phone_number?: string | null
          postal_code?: string | null
          roles?: Database["public"]["Enums"]["organization_role"][]
          state?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      purchase_scan_queue: {
        Row: {
          attachment_id: string
          created_at: string
          created_by: string | null
          error: string | null
          file_name: string
          id: string
          organization_id: string
          scanned_data: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attachment_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          file_name: string
          id?: string
          organization_id: string
          scanned_data?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attachment_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          file_name?: string
          id?: string
          organization_id?: string
          scanned_data?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_scan_queue_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_scan_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          asset_id: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          gig_id: string | null
          id: string
          item_cost: number | null
          item_price: number | null
          line_amount: number | null
          line_cost: number | null
          organization_id: string
          parent_id: string | null
          payment_method: string | null
          purchase_date: string | null
          quantity: number | null
          row_type: string
          tax_treatment: string | null
          total_inv_amount: number | null
          updated_at: string
          updated_by: string | null
          vendor: string | null
        }
        Insert: {
          asset_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gig_id?: string | null
          id?: string
          item_cost?: number | null
          item_price?: number | null
          line_amount?: number | null
          line_cost?: number | null
          organization_id: string
          parent_id?: string | null
          payment_method?: string | null
          purchase_date?: string | null
          quantity?: number | null
          row_type: string
          tax_treatment?: string | null
          total_inv_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor?: string | null
        }
        Update: {
          asset_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gig_id?: string | null
          id?: string
          item_cost?: number | null
          item_price?: number | null
          line_amount?: number | null
          line_cost?: number | null
          organization_id?: string
          parent_id?: string | null
          payment_method?: string | null
          purchase_date?: string | null
          quantity?: number | null
          row_type?: string
          tax_treatment?: string | null
          total_inv_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_c_lines: {
        Row: {
          code: string
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          label: string
          sort_order: number
        }
        Update: {
          code?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      staff_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_years: {
        Row: {
          created_at: string
          filed_on: string | null
          locked: boolean
          notes: string | null
          organization_id: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          filed_on?: string | null
          locked?: boolean
          notes?: string | null
          organization_id: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          filed_on?: string | null
          locked?: boolean
          notes?: string | null
          organization_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_years_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_devices: {
        Row: {
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          last_used_at: string
          public_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          last_used_at?: string
          public_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          last_used_at?: string
          public_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_google_calendar_settings: {
        Row: {
          access_token: string
          calendar_id: string
          calendar_name: string | null
          created_at: string
          id: string
          is_enabled: boolean
          refresh_token: string
          sync_filters: Json | null
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id: string
          calendar_name?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          refresh_token: string
          sync_filters?: Json | null
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string
          calendar_name?: string | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          refresh_token?: string
          sync_filters?: Json | null
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_google_calendar_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          platform_moderator: boolean
          postal_code: string | null
          role_hint: string | null
          state: string | null
          timezone: string | null
          updated_at: string
          user_status: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id: string
          last_name: string
          phone?: string | null
          platform_moderator?: boolean
          postal_code?: string | null
          role_hint?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
          user_status?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          platform_moderator?: boolean
          postal_code?: string | null
          role_hint?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
          user_status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acting_user: { Args: { p_claimed: string }; Returns: string }
      activity_entity_is_shared: {
        Args: { p_entity_type: string }
        Returns: boolean
      }
      add_gig_participant_contact: {
        Args: {
          p_actor_id?: string
          p_gig_id: string
          p_is_primary?: boolean
          p_organization_id: string
          p_title?: string
          p_user_id: string
        }
        Returns: Json
      }
      add_organization_contact:
        | {
            Args: {
              p_actor_id?: string
              p_email?: string
              p_first_name?: string
              p_is_primary?: boolean
              p_last_name?: string
              p_organization_id: string
              p_phone?: string
              p_role?: Database["public"]["Enums"]["user_role"]
              p_title?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_id?: string
              p_email: string
              p_first_name: string
              p_is_primary?: boolean
              p_last_name: string
              p_organization_id: string
              p_phone?: string
              p_title?: string
            }
            Returns: Json
          }
      add_purchase_line_units: {
        Args: { p_line_id: string; p_units: Json[] }
        Returns: string[]
      }
      asset_depreciated_line_date: {
        Args: { p_asset: string }
        Returns: string
      }
      asset_is_unit: {
        Args: { p_asset: Database["public"]["Tables"]["assets"]["Row"] }
        Returns: boolean
      }
      assets_clear_flag_out_of_service: {
        Args: {
          p_new: Database["public"]["Tables"]["assets"]["Row"]
          p_old: Database["public"]["Tables"]["assets"]["Row"]
          p_op: string
        }
        Returns: {
          acquisition_date: string
          category: string
          created_at: string
          created_by: string
          description: string | null
          equipment_item_id: string
          id: string
          insurance_class: string | null
          insurance_policy_added: boolean
          item_cost: number | null
          item_price: number | null
          liquidation_amt: number | null
          maintenance_by: string | null
          maintenance_expected_back: string | null
          maintenance_from: string | null
          maintenance_location: string | null
          maintenance_notes: string | null
          maintenance_pending: boolean
          maintenance_pending_gig_id: string | null
          maintenance_pending_quantity: number | null
          maintenance_since: string | null
          manufacturer_model: string
          organization_id: string
          purchase_id: string | null
          purchase_line_id: string | null
          quantity: number | null
          recovery_period: number | null
          replacement_value: number | null
          retired_on: string | null
          serial_number: string | null
          status: string
          status_before_maintenance: string | null
          status_before_write_off: string | null
          tag_number: string | null
          type: string | null
          updated_at: string
          updated_by: string
          vendor: string | null
          written_off_from: string | null
        }
        SetofOptions: {
          from: "*"
          to: "assets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_pending_user_to_active: {
        Args: { p_auth_user_id: string; p_email: string }
        Returns: Json
      }
      create_contact_person: {
        Args: {
          p_actor_id?: string
          p_email?: string
          p_first_name: string
          p_last_name: string
          p_phone?: string
        }
        Returns: string
      }
      create_gig_complex: {
        Args: { p_gig_data: Json; p_participants?: Json; p_staff_slots?: Json }
        Returns: {
          id: string
        }[]
      }
      create_purchase_transaction_v2: {
        Args: { p_header: Json; p_items: Json[]; p_units: Json[] }
        Returns: Json
      }
      ensure_org_categories: { Args: { p_org: string }; Returns: undefined }
      equipment_category_recovery_period: {
        Args: { p_category: string; p_org: string }
        Returns: number
      }
      equipment_item_for: {
        Args: {
          p_category: string
          p_description?: string
          p_insurance_class?: string
          p_model: string
          p_org: string
          p_type?: string
          p_user?: string
        }
        Returns: string
      }
      equipment_match_key: { Args: { p: string }; Returns: string }
      equipment_tidy_name: { Args: { p: string }; Returns: string }
      get_complete_user_data: { Args: { user_uuid: string }; Returns: Json }
      get_kit_hierarchy_tree: {
        Args: { p_kit_id: string }
        Returns: {
          child_kit_id: string
          depth: number
          parent_kit_id: string
          quantity: number
        }[]
      }
      get_user_email: { Args: { user_uuid: string }; Returns: string }
      get_user_ids_in_same_orgs: {
        Args: { user_uuid: string }
        Returns: {
          member_user_id: string
        }[]
      }
      get_user_organizations_secure: {
        Args: { user_uuid: string }
        Returns: {
          created_at: string
          organization: Json
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }[]
      }
      get_user_profile_secure: {
        Args: { user_uuid: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone: string | null
          platform_moderator: boolean
          postal_code: string | null
          role_hint: string | null
          state: string | null
          timezone: string | null
          updated_at: string
          user_status: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "users"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_role_in_org: {
        Args: { org_id: string; user_uuid: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      gig_activity_actor_org: {
        Args: { p_actor: string; p_gig_id: string; p_subject_org: string }
        Returns: string
      }
      gig_staff_slot_org_id: { Args: { p_slot_id: string }; Returns: string }
      insert_purchase_line_unit: {
        Args: {
          p_header: Database["public"]["Tables"]["purchases"]["Row"]
          p_line: Database["public"]["Tables"]["purchases"]["Row"]
          p_unit: Json
        }
        Returns: string
      }
      invite_user_to_organization:
        | {
            Args: {
              p_email: string
              p_first_name?: string
              p_last_name?: string
              p_organization_id: string
              p_role: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_email: string
              p_first_name?: string
              p_inviter_id?: string
              p_last_name?: string
              p_organization_id: string
              p_role: string
            }
            Returns: Json
          }
      is_platform_moderator: { Args: never; Returns: boolean }
      kit_would_create_cycle: {
        Args: { p_child_kit_id: string; p_parent_kit_id: string }
        Returns: boolean
      }
      kits_that_would_cycle: {
        Args: { p_candidate_kit_ids: string[]; p_parent_kit_id: string }
        Returns: {
          kit_id: string
        }[]
      }
      link_existing_person_to_organization: {
        Args: {
          p_actor_id?: string
          p_is_primary?: boolean
          p_organization_id: string
          p_role?: Database["public"]["Enums"]["user_role"]
          p_title?: string
          p_user_id: string
        }
        Returns: Json
      }
      log_activity: {
        Args: {
          p_context: Json
          p_entity_id: string
          p_entity_type: string
          p_event_type: string
          p_gig_id: string
          p_organization_id: string
        }
        Returns: string
      }
      log_participant_event: {
        Args: {
          p_entity_id: string
          p_event: string
          p_extra?: Json
          p_gig_id: string
          p_subject_org: string
        }
        Returns: undefined
      }
      lot_pieces_out: {
        Args: { p_asset_id: string; p_gig_id?: string }
        Returns: number
      }
      maintenance_apply: { Args: { p_asset_id: string }; Returns: string }
      maintenance_log: {
        Args: {
          p_asset: Database["public"]["Tables"]["assets"]["Row"]
          p_context: Json
          p_event: string
          p_gig_id?: string
        }
        Returns: undefined
      }
      maintenance_send: {
        Args: {
          p_asset_id: string
          p_check_home: boolean
          p_expected_back: string
          p_gig_id: string
          p_location: string
          p_notes: string
          p_quantity: number
        }
        Returns: string
      }
      member_role_in_org: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      org_is_claimed: { Args: { p_org_id: string }; Returns: boolean }
      org_participates_in_gig: {
        Args: { p_gig_id: string; p_org_id: string }
        Returns: boolean
      }
      purchase_line_depreciated_date: {
        Args: { p_line: string }
        Returns: string
      }
      refresh_kit_flattened_cache: {
        Args: { p_kit_id: string }
        Returns: undefined
      }
      refresh_kit_flattened_cache_cascade: {
        Args: { p_kit_id: string }
        Returns: undefined
      }
      remove_gig_participant_contact: {
        Args: {
          p_actor_id?: string
          p_gig_id: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      remove_organization_contact: {
        Args: { p_actor_id?: string; p_member_id: string }
        Returns: undefined
      }
      return_to_service: { Args: { p_asset_id: string }; Returns: string }
      search_name_rank: {
        Args: { p_name: string; p_query: string }
        Returns: number
      }
      search_organizations: {
        Args: {
          p_query: string
          p_type?: Database["public"]["Enums"]["organization_role"]
        }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          allowed_domains: string | null
          city: string | null
          claimed: boolean
          country: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          phone_number: string | null
          postal_code: string | null
          roles: Database["public"]["Enums"]["organization_role"][]
          state: string | null
          updated_at: string
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_people: {
        Args: { p_email?: string; p_phone?: string; p_query: string }
        Returns: {
          email_hint: string
          first_name: string
          id: string
          last_name: string
          matched_on: string
          organization_names: string[]
        }[]
      }
      send_to_maintenance: {
        Args: {
          p_asset_id: string
          p_expected_back?: string | null
          p_gig_id?: string | null
          p_location?: string | null
          p_notes?: string | null
          p_quantity: number
        }
        Returns: string
      }
      set_gig_participant_contact_primary: {
        Args: {
          p_actor_id?: string
          p_gig_id: string
          p_is_primary: boolean
          p_organization_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      set_organization_primary_contact: {
        Args: { p_actor_id?: string; p_member_id: string }
        Returns: undefined
      }
      signed_in_email: { Args: never; Returns: string }
      tax_year_is_locked: {
        Args: { p_date: string; p_org: string }
        Returns: boolean
      }
      undo_write_off: { Args: { p_asset_id: string }; Returns: string }
      unit_out_at: { Args: { p_asset_id: string }; Returns: string }
      unset_organization_primary_contact: {
        Args: { p_actor_id?: string; p_member_id: string }
        Returns: undefined
      }
      update_asset_status: {
        Args: { p_asset_id: string; p_status: string }
        Returns: undefined
      }
      update_maintenance: {
        Args: {
          p_asset_id: string
          p_expected_back: string | null
          p_location: string | null
          p_notes: string | null
        }
        Returns: undefined
      }
      update_organization_contact: {
        Args: {
          p_actor_id?: string
          p_first_name: string
          p_last_name: string
          p_member_id: string
          p_phone: string
          p_title: string
        }
        Returns: undefined
      }
      user_can_delete_gig: {
        Args: { p_gig_id: string; p_user: string }
        Returns: boolean
      }
      user_can_manage_gig: {
        Args: { gig_id: string; user_uuid: string }
        Returns: boolean
      }
      user_can_manage_gig_active: {
        Args: { p_gig_id: string; p_user: string }
        Returns: boolean
      }
      user_can_manage_org_contacts: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      user_has_access_to_gig: {
        Args: { gig_id: string; user_uuid: string }
        Returns: boolean
      }
      user_is_admin: { Args: { user_uuid: string }; Returns: boolean }
      user_is_admin_of_gig: {
        Args: { gig_id: string; user_uuid: string }
        Returns: boolean
      }
      user_is_admin_of_org: {
        Args: { org_id: string; user_uuid: string }
        Returns: boolean
      }
      user_is_admin_or_manager_of_org: {
        Args: { org_id: string; user_uuid: string }
        Returns: boolean
      }
      user_is_assigned_to_staff_slot: {
        Args: { p_slot_id: string; p_user_id: string }
        Returns: boolean
      }
      user_is_contact_status: { Args: { p_user_id: string }; Returns: boolean }
      user_is_member_of_org: {
        Args: { org_id: string; user_uuid: string }
        Returns: boolean
      }
      user_is_staff_or_above_of_org: {
        Args: { org_id: string; user_uuid: string }
        Returns: boolean
      }
      user_manages_gig_owner: {
        Args: { p_gig_id: string; p_user: string }
        Returns: boolean
      }
      user_manages_person: {
        Args: { p_actor: string; p_person: string }
        Returns: boolean
      }
      user_organization_ids: {
        Args: { user_uuid: string }
        Returns: {
          organization_id: string
        }[]
      }
      write_off_pieces: {
        Args: {
          p_asset_id: string
          p_gig_id?: string
          p_kit_id?: string
          p_note?: string
          p_on?: string
          p_quantity: number
          p_still_out?: number
        }
        Returns: string
      }
    }
    Enums: {
      fin_category:
        | "Advertising"
        | "Car and truck expenses"
        | "Commissions and fees"
        | "Contract labor"
        | "Depreciation"
        | "Insurance"
        | "Legal and professional services"
        | "Office expense"
        | "Rent or lease"
        | "Repairs and maintenance"
        | "Supplies"
        | "Taxes and licenses"
        | "Travel"
        | "Meals"
        | "Utilities"
        | "Wages"
        | "Other expenses"
      fin_direction: "in" | "out"
      fin_stage:
        | "requested"
        | "quoted"
        | "accepted"
        | "contract_sent"
        | "contracted"
        | "invoiced"
        | "paid"
        | "declined"
        | "cancelled"
      fin_type:
        | "Bid Submitted"
        | "Bid Accepted"
        | "Bid Rejected"
        | "Contract Submitted"
        | "Contract Revised"
        | "Contract Signed"
        | "Contract Rejected"
        | "Contract Cancelled"
        | "Contract Settled"
        | "Sub-Contract Submitted"
        | "Sub-Contract Revised"
        | "Sub-Contract Signed"
        | "Sub-Contract Rejected"
        | "Sub-Contract Cancelled"
        | "Sub-Contract Settled"
        | "Deposit Received"
        | "Deposit Sent"
        | "Deposit Refunded"
        | "Payment Sent"
        | "Payment Received"
        | "Expense Incurred"
        | "Expense Reimbursed"
        | "Invoice Issued"
        | "Invoice Settled"
        | "Informal Terms"
      gig_status:
        | "DateHold"
        | "Proposed"
        | "Booked"
        | "Completed"
        | "Cancelled"
        | "Settled"
      organization_role:
        | "Production"
        | "Sound"
        | "Lighting"
        | "Staging"
        | "Rentals"
        | "Venue"
        | "Act"
        | "Agency"
      sync_status: "pending" | "synced" | "failed" | "updated" | "removed"
      user_role: "Admin" | "Manager" | "Staff" | "Viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      fin_category: [
        "Advertising",
        "Car and truck expenses",
        "Commissions and fees",
        "Contract labor",
        "Depreciation",
        "Insurance",
        "Legal and professional services",
        "Office expense",
        "Rent or lease",
        "Repairs and maintenance",
        "Supplies",
        "Taxes and licenses",
        "Travel",
        "Meals",
        "Utilities",
        "Wages",
        "Other expenses",
      ],
      fin_direction: ["in", "out"],
      fin_stage: [
        "requested",
        "quoted",
        "accepted",
        "contract_sent",
        "contracted",
        "invoiced",
        "paid",
        "declined",
        "cancelled",
      ],
      fin_type: [
        "Bid Submitted",
        "Bid Accepted",
        "Bid Rejected",
        "Contract Submitted",
        "Contract Revised",
        "Contract Signed",
        "Contract Rejected",
        "Contract Cancelled",
        "Contract Settled",
        "Sub-Contract Submitted",
        "Sub-Contract Revised",
        "Sub-Contract Signed",
        "Sub-Contract Rejected",
        "Sub-Contract Cancelled",
        "Sub-Contract Settled",
        "Deposit Received",
        "Deposit Sent",
        "Deposit Refunded",
        "Payment Sent",
        "Payment Received",
        "Expense Incurred",
        "Expense Reimbursed",
        "Invoice Issued",
        "Invoice Settled",
        "Informal Terms",
      ],
      gig_status: [
        "DateHold",
        "Proposed",
        "Booked",
        "Completed",
        "Cancelled",
        "Settled",
      ],
      organization_role: [
        "Production",
        "Sound",
        "Lighting",
        "Staging",
        "Rentals",
        "Venue",
        "Act",
        "Agency",
      ],
      sync_status: ["pending", "synced", "failed", "updated", "removed"],
      user_role: ["Admin", "Manager", "Staff", "Viewer"],
    },
  },
} as const
