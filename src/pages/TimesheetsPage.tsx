import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  CircularProgress,
} from '@mui/material';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UnifiedTimesheet } from '../components/UnifiedTimesheet';

interface ProjectWithClient {
  id: string;
  name: string;
  client_id: string;
  client?: { id: string; name: string } | null;
}

export function TimesheetsPage() {
  const { isAdmin, consultantId } = useAuth();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['timesheet-projects', isAdmin, consultantId],
    queryFn: async () => {
      const { data: projectsData, error: projErr } = await supabase
        .from('projects')
        .select('id, name, client_id, client:clients(id, name)')
        .eq('status', 'active')
        .order('name');
      if (projErr) throw projErr;
      const list = (projectsData ?? []) as unknown as ProjectWithClient[];

      if (isAdmin) return list;

      if (!consultantId) return [];

      const { data: assignments } = await supabase
        .from('activity_assignments')
        .select('activity_id')
        .eq('consultant_id', consultantId);
      const activityIds = [...new Set((assignments ?? []).map((a: { activity_id: string }) => a.activity_id))];
      if (activityIds.length === 0) return [];

      const { data: activities } = await supabase
        .from('activities')
        .select('id, phase_id')
        .in('id', activityIds);
      const phaseIds = [...new Set((activities ?? []).map((a: { phase_id: string }) => a.phase_id))];
      if (phaseIds.length === 0) return [];

      const { data: phases } = await supabase
        .from('phases')
        .select('id, project_id')
        .in('id', phaseIds);
      const allowedProjectIds = new Set((phases ?? []).map((p: { project_id: string }) => p.project_id));

      return list.filter((p) => allowedProjectIds.has(p.id));
    },
  });

  return (
    <Box sx={{ maxWidth: 1600, width: '100%' }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
        Timesheets
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {isAdmin
          ? 'Log time for any active project. Rows are grouped by project.'
          : 'Log time for projects you’re allocated to. Add rows from different projects in one place.'}
      </Typography>

      {isLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading…</Typography>
        </Box>
      ) : projects.length === 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography color="text.secondary">
              {!consultantId && !isAdmin
                ? 'Your account is not linked to a consultant. Ask an admin to link you on the Consultants page.'
                : isAdmin
                  ? 'No active projects yet. Set a project to Active in the Projects area to log time.'
                  : 'You’re not allocated to any active projects yet.'}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <UnifiedTimesheet projects={projects} consultantId={consultantId} isAdmin={isAdmin} />
      )}
    </Box>
  );
}
