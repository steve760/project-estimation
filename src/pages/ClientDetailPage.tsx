import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { ArrowBack as BackIcon, Add as AddIcon } from '@mui/icons-material';
import { supabase } from '../lib/supabase';
import type {
  Client,
  Project,
  Phase,
  Activity,
  ActivityAssignment,
  Consultant,
  PhaseWithActivitiesDisplay,
  ActivityWithAssignmentsDisplay,
} from '../types/database';
import { computeFinancialSummary, roundCurrency } from '../lib/calculations';

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});
type ProjectForm = z.infer<typeof projectSchema>;

interface ProjectWithDetails extends Project {
  phases?: PhaseWithActivitiesDisplay[];
}

async function fetchClientWithProjects(clientId: string) {
  const [clientRes, projectsRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('projects').select('*').eq('client_id', clientId).order('created_at'),
  ]);
  const { data: client, error: clientError } = clientRes;
  const { data: projects } = projectsRes;
  if (clientError || !client) throw new Error('Client not found');
  const projectList = (projects ?? []) as Project[];

  if (projectList.length === 0) return { client: client as Client, projects: [] };

  const projectIds = projectList.map((p) => p.id);
  const { data: allPhases } = await supabase.from('phases').select('*').in('project_id', projectIds).order('sort_order');
  const phasesList = (allPhases ?? []) as Phase[];
  if (phasesList.length === 0) {
    return { client: client as Client, projects: projectList.map((p) => ({ ...p, phases: [] })) };
  }

  const phaseIds = phasesList.map((p) => p.id);
  const { data: allActivities } = await supabase.from('activities').select('*').in('phase_id', phaseIds).order('sort_order');
  const activitiesList = (allActivities ?? []) as Activity[];
  if (activitiesList.length === 0) {
    const phasesByProject = new Map<string, PhaseWithActivitiesDisplay[]>();
    for (const ph of phasesList) {
      const list = phasesByProject.get(ph.project_id) ?? [];
      list.push({ ...ph, activities: [] });
      phasesByProject.set(ph.project_id, list);
    }
    return {
      client: client as Client,
      projects: projectList.map((p) => ({ ...p, phases: phasesByProject.get(p.id) ?? [] })),
    };
  }

  const activityIds = activitiesList.map((a) => a.id);
  const [assignmentsRes, consultantIdsRes] = await Promise.all([
    supabase.from('activity_assignments').select('*').in('activity_id', activityIds),
    supabase.from('activity_assignments').select('consultant_id').in('activity_id', activityIds),
  ]);
  const assignmentsList = (assignmentsRes.data ?? []) as ActivityAssignment[];
  const cIds = [...new Set((consultantIdsRes.data ?? []).map((a: { consultant_id: string }) => a.consultant_id))];
  const { data: consultantsList } = cIds.length
    ? await supabase.from('consultants').select('*').in('id', cIds)
    : { data: [] };
  const consultantMap2 = new Map(((consultantsList ?? []) as Consultant[]).map((c) => [c.id, c]));
  const assignmentsByActivity = new Map<string, (ActivityAssignment & { consultant?: Consultant })[]>();
  for (const a of assignmentsList) {
    const list = assignmentsByActivity.get(a.activity_id) ?? [];
    list.push({ ...a, consultant: consultantMap2.get(a.consultant_id) });
    assignmentsByActivity.set(a.activity_id, list);
  }
  for (const list of assignmentsByActivity.values()) list.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));

  const activitiesByPhase = new Map<string, ActivityWithAssignmentsDisplay[]>();
  for (const act of activitiesList) {
    const list = activitiesByPhase.get(act.phase_id) ?? [];
    list.push({ ...act, assignments: assignmentsByActivity.get(act.id) ?? [] });
    activitiesByPhase.set(act.phase_id, list);
  }

  const phasesByProject = new Map<string, PhaseWithActivitiesDisplay[]>();
  for (const ph of phasesList) {
    const list = phasesByProject.get(ph.project_id) ?? [];
    list.push({ ...ph, activities: activitiesByPhase.get(ph.id) ?? [] });
    phasesByProject.set(ph.project_id, list);
  }

  const projectsWithPhases: ProjectWithDetails[] = projectList.map((p) => ({
    ...p,
    phases: phasesByProject.get(p.id) ?? [],
  }));
  return { client: client as Client, projects: projectsWithPhases };
}

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: (): Promise<{ client: Client; projects: ProjectWithDetails[] }> => fetchClientWithProjects(clientId!),
    enabled: !!clientId,
  });

  const createProjectMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!clientId) throw new Error('No client');
      const { data, error } = await supabase
        .from('projects')
        .insert({ client_id: clientId, name })
        .select()
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setNewProjectModalOpen(false);
      reset({ name: '' });
      navigate(`/clients/${clientId}/projects/${data.id}`);
    },
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: '' },
  });

  if (!clientId) {
    navigate('/clients');
    return null;
  }

  if (isLoading || !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  const { client, projects } = data;

  return (
    <Box sx={{ maxWidth: 1600, width: '100%', mx: 'auto' }}>
      <Button startIcon={<BackIcon />} onClick={() => navigate('/')} sx={{ mb: 2 }}>
        Back to clients
      </Button>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <div>
          <Typography variant="h4" fontWeight={600}>
            {client.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Projects
          </Typography>
        </div>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewProjectModalOpen(true)}
        >
          Add project
        </Button>
      </Box>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Projects
      </Typography>
      {projects.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary">No projects yet. Add a project to get started.</Typography>
          </CardContent>
        </Card>
      ) : (
        projects.map((project) => {
          const projectAssignments: { hours: number; consultant: Consultant }[] = [];
          for (const phase of project.phases ?? []) {
            for (const activity of phase.activities ?? []) {
              for (const a of activity.assignments ?? []) {
                if (a.consultant) projectAssignments.push({ hours: a.hours, consultant: a.consultant });
              }
            }
          }
          const summary = computeFinancialSummary(projectAssignments);
          const grossProfit = summary.profit;
          const uniqueConsultants = [...new Map(projectAssignments.map((p) => [p.consultant.id, p.consultant])).values()];

          return (
            <Card
              key={project.id}
              sx={{
                mb: 2,
                cursor: 'pointer',
                transition: 'background-color 0.2s, box-shadow 0.2s',
                '&:hover': {
                  backgroundColor: 'secondary.light',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                },
              }}
              onClick={() => navigate(`/clients/${clientId}/projects/${project.id}`)}
            >
              <CardContent>
                <Typography variant="h6" fontWeight={600}>
                  {project.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, mt: 1.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Revenue</Typography>
                    <Typography variant="body1" fontWeight={600}>
                      ${roundCurrency(summary.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Cost</Typography>
                    <Typography variant="body1" fontWeight={600}>
                      ${roundCurrency(summary.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Gross profit</Typography>
                    <Typography variant="body1" fontWeight={600} color={grossProfit >= 0 ? 'success.main' : 'error.main'}>
                      ${roundCurrency(grossProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                  {uniqueConsultants.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', ml: 'auto', alignItems: 'flex-end' }}>
                      {uniqueConsultants.map((c) => (
                        <Chip key={c.id} label={c.name} size="small" color="primary" variant="outlined" sx={{ fontWeight: 500 }} />
                      ))}
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={newProjectModalOpen} onClose={() => setNewProjectModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New project</DialogTitle>
        <form onSubmit={handleSubmit((d) => createProjectMutation.mutate(d.name))}>
          <DialogContent>
            <TextField
              {...register('name')}
              label="Project name"
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
              autoFocus
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setNewProjectModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createProjectMutation.isPending}>
              Create project
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
