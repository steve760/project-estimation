export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      consultants: {
        Row: {
          id: string;
          name: string;
          cost_per_hour: number;
          charge_out_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          cost_per_hour?: number;
          charge_out_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          cost_per_hour?: number;
          charge_out_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      phases: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      activities: {
        Row: {
          id: string;
          phase_id: string;
          name: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phase_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phase_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      activity_assignments: {
        Row: {
          id: string;
          activity_id: string;
          consultant_id: string;
          hours: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          activity_id: string;
          consultant_id: string;
          hours: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          activity_id?: string;
          consultant_id?: string;
          hours?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
