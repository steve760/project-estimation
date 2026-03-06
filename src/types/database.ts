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
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
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
  consultant_id: string;
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

// Phase/Activity with nested assignments (for project detail views)
export interface ActivityWithAssignmentsDisplay extends Activity {
  assignments?: (ActivityAssignment & { consultant?: Consultant })[];
}

export interface PhaseWithActivitiesDisplay extends Phase {
  activities?: ActivityWithAssignmentsDisplay[];
}
