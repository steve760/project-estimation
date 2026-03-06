export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Consultant {
  id: string;
  name: string;
  cost_per_hour: number;
  charge_out_rate: number;
  avatar_url?: string | null;
  color?: string | null;
  inactive?: boolean;
  /** Auth: links to Supabase auth.users when this consultant can log in */
  user_id?: string | null;
  /** Auth: admin or user; only present when consultant is linked to a user */
  role?: 'admin' | 'user' | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  color?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  status?: 'proposal' | 'active';
  non_billable?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Phase {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  phase_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityAssignment {
  id: string;
  activity_id: string;
  consultant_id: string | null;
  hours: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Joined types for display
export interface ActivityAssignmentWithConsultant extends ActivityAssignment {
  consultant?: Consultant;
}

export interface ActivityWithAssignments extends Activity {
  activity_assignments?: ActivityAssignmentWithConsultant[];
}

export interface PhaseWithActivities extends Phase {
  activities?: ActivityWithAssignments[];
}

export interface ProjectWithPhases extends Project {
  phases?: PhaseWithActivities[];
}

export interface ClientWithProjects extends Client {
  projects?: ProjectWithPhases[];
}

// Calculation results
export interface FinancialSummary {
  cost: number;
  revenue: number;
  profit: number;
  marginPercent: number;
}

export interface ProjectConsultantRate {
  project_id: string;
  consultant_id: string;
  charge_out_rate: number;
  created_at?: string;
  updated_at?: string;
}

export interface Profile {
  id: string;
  role: 'admin' | 'user';
  consultant_id: string | null;
}

export interface TimeEntry {
  id: string;
  consultant_id: string;
  project_id: string;
  activity_id: string;
  entry_date: string;
  hours: number;
  notes: string | null;
  created_at: string;
}

// Phase/Activity with nested assignments (for project detail views)
export interface ActivityWithAssignmentsDisplay extends Activity {
  assignments?: (ActivityAssignment & { consultant?: Consultant })[];
}

export interface PhaseWithActivitiesDisplay extends Phase {
  activities?: ActivityWithAssignmentsDisplay[];
}
