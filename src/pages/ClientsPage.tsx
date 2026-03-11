import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Divider,
  TextField,
  Avatar,
  IconButton,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Client } from '../types/database';
import type { Consultant } from '../types/database';
import { computeFinancialSummary } from '../lib/calculations';

async function fetchClientAverageGp(clientIds: string[]): Promise<Record<string, number>> {
  if (clientIds.length === 0) return {};
  const { data: projects } = await supabase.from('projects').select('id, client_id').in('client_id', clientIds);
  const projectList = projects ?? [];
  if (projectList.length === 0) return {};
  const projectIds = projectList.map((p) => p.id);
  const { data: phases } = await supabase.from('phases').select('id, project_id').in('project_id', projectIds);
  const phasesList = phases ?? [];
  const phaseIds = phasesList.map((p) => p.id);
  if (phaseIds.length === 0) return {};
  const { data: activities } = await supabase.from('activities').select('id, phase_id').in('phase_id', phaseIds);
  const activitiesList = activities ?? [];
  const activityIds = activitiesList.map((a) => a.id);
  if (activityIds.length === 0) return {};
  const [assignmentsRes, consultantIdsRes] = await Promise.all([
    supabase.from('activity_assignments').select('*').in('activity_id', activityIds),
    supabase.from('activity_assignments').select('consultant_id').in('activity_id', activityIds),
  ]);
  const assignmentsList = (assignmentsRes.data ?? []) as { id: string; activity_id: string; consultant_id: string | null; hours: number }[];
  const cIds = [...new Set((consultantIdsRes.data ?? []).map((a: { consultant_id: string | null }) => a.consultant_id).filter(Boolean))] as string[];
  const { data: consultantsList } = cIds.length ? await supabase.from('consultants').select('*').in('id', cIds) : { data: [] };
  const consultantMap = new Map(((consultantsList ?? []) as Consultant[]).map((c) => [c.id, c]));
  const activityToPhase = new Map<string, string>();
  for (const a of activitiesList) activityToPhase.set(a.id, a.phase_id);
  const phaseToProject = new Map<string, string>();
  for (const p of phasesList) phaseToProject.set(p.id, p.project_id);
  const projectToClient = new Map<string, string>();
  for (const p of projectList) projectToClient.set(p.id, p.client_id);
  const projectAssignments = new Map<string, { hours: number; consultant: Consultant }[]>();
  for (const a of assignmentsList) {
    if (!a.consultant_id) continue;
    const consultant = consultantMap.get(a.consultant_id);
    if (!consultant) continue;
    const phaseId = activityToPhase.get(a.activity_id);
    const projectId = phaseId ? phaseToProject.get(phaseId) : undefined;
    if (!projectId) continue;
    const list = projectAssignments.get(projectId) ?? [];
    list.push({ hours: a.hours, consultant });
    projectAssignments.set(projectId, list);
  }
  const clientMargins = new Map<string, number[]>();
  for (const proj of projectList) {
    const assignments = projectAssignments.get(proj.id) ?? [];
    const summary = computeFinancialSummary(assignments);
    const clientId = proj.client_id;
    const list = clientMargins.get(clientId) ?? [];
    list.push(summary.marginPercent);
    clientMargins.set(clientId, list);
  }
  const result: Record<string, number> = {};
  for (const clientId of clientIds) {
    const margins = clientMargins.get(clientId) ?? [];
    if (margins.length === 0) continue;
    result[clientId] = margins.reduce((a, b) => a + b, 0) / margins.length;
  }
  return result;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || name.slice(0, 2).toUpperCase() || '?';
}

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

type ClientForm = z.infer<typeof clientSchema>;

const CLIENT_COLORS = [
  '#6D5CBE', '#B69AF2', '#10b981', '#ef4444', '#f59e0b',
  '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316',
];

async function fetchClients() {
  const { data, error } = await supabase.from('clients').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as Client[];
}

async function createClient(input: ClientForm & { color?: string }) {
  const nameTrim = input.name.trim();
  const { data: existing } = await supabase.from('clients').select('id, name');
  if ((existing ?? []).some((c) => c.name.trim().toLowerCase() === nameTrim.toLowerCase())) {
    throw new Error('A client with this name already exists.');
  }
  const { data, error } = await supabase.from('clients').insert({ name: nameTrim, color: input.color ?? null }).select().single();
  if (error) throw error;
  return data as Client;
}

async function updateClient(id: string, input: ClientForm) {
  const nameTrim = input.name.trim();
  const { data: existing } = await supabase.from('clients').select('id, name');
  if ((existing ?? []).some((c) => c.id !== id && c.name.trim().toLowerCase() === nameTrim.toLowerCase())) {
    throw new Error('A client with this name already exists.');
  }
  const { data, error } = await supabase.from('clients').update({ name: nameTrim }).eq('id', id).select().single();
  if (error) throw error;
  return data as Client;
}

async function deleteClient(id: string) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

export function ClientsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: fetchClients,
  });

  const clientIds = clients.map((c) => c.id);
  const { data: averageGpByClient = {} } = useQuery({
    queryKey: ['clients', 'average-gp', clientIds],
    queryFn: () => fetchClientAverageGp(clientIds),
    enabled: clientIds.length > 0,
  });

  const rows = clients.map((c) => ({ ...c, averageGpPercent: averageGpByClient[c.id] }));

  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setModalOpen(false);
      reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ClientForm }) => updateClient(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setModalOpen(false);
      setEditingId(null);
      reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setClientToDelete(null);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: '' },
  });

  const openCreate = () => {
    setEditingId(null);
    reset({ name: '' });
    setModalOpen(true);
  };

  const onSubmit = (data: ClientForm) => {
    if (editingId) updateMutation.mutate({ id: editingId, input: data });
    else {
      const color = CLIENT_COLORS[clients.length % CLIENT_COLORS.length];
      createMutation.mutate({ ...data, color });
    }
  };

  const columns: GridColDef<Client & { averageGpPercent?: number }>[] = [
    {
      field: 'name',
      headerName: 'Client name',
      flex: 1,
      minWidth: 200,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: row.color ?? 'primary.main' }}>
            {getInitials(row.name)}
          </Avatar>
          <Typography variant="body2" fontWeight={400}>
            {row.name}
          </Typography>
        </Box>
      ),
    },
    ...(isAdmin
      ? [
          {
            field: 'averageGpPercent',
            headerName: 'Average GP %',
            width: 120,
            type: 'number' as const,
            align: 'left' as const,
            headerAlign: 'left' as const,
            valueGetter: (_: unknown, row: Client & { averageGpPercent?: number }) => row.averageGpPercent,
            renderCell: ({ row }: { row: Client & { averageGpPercent?: number } }) => {
              const value = row.averageGpPercent;
              if (value == null) return <Typography variant="body2" color="text.secondary">—</Typography>;
              return (
                <Typography variant="body2" fontWeight={500} color={value >= 0 ? 'success.main' : 'error.main'}>
                  {value.toFixed(1)}%
                </Typography>
              );
            },
          },
        ]
      : []),
    {
      field: 'actions',
      headerName: '',
      width: 56,
      sortable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'inline-block' }}>
          <IconButton size="small" onClick={() => setClientToDelete(row)} title="Delete client" color="error">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    },
  ];

  return (
    <Box sx={{ maxWidth: 1600, width: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <div>
          <Typography variant="h4" fontWeight={600}>
            Projects
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage clients and their projects
          </Typography>
        </div>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add client
        </Button>
      </Box>

      <Card>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={isLoading}
          autoHeight
          onRowClick={({ row }) => navigate(`/clients/${row.id}`)}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          sx={{
            border: 'none',
            cursor: 'pointer',
            '& .MuiDataGrid-cell:focus': { outline: 'none' },
            '& .MuiDataGrid-cell': { alignItems: 'center', display: 'flex' },
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'grey.50' },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700 },
            '& .MuiDataGrid-row:hover': { backgroundColor: 'secondary.light' },
          }}
        />
      </Card>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <Box sx={{ bgcolor: 'grey.50' }}>
          <DialogTitle>{editingId ? 'Edit client' : 'New client'}</DialogTitle>
        </Box>
        <Divider />
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent sx={{ pt: 4 }}>
            <TextField
              {...register('name')}
              label="Client name"
              fullWidth
              error={!!errors.name || !!createMutation.error || !!updateMutation.error}
              helperText={errors.name?.message ?? (createMutation.error as Error)?.message ?? (updateMutation.error as Error)?.message}
              autoFocus
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? 'Save' : 'Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={!!clientToDelete}
        onClose={() => !deleteMutation.isPending && setClientToDelete(null)}
        aria-labelledby="delete-client-dialog-title"
      >
        <Box sx={{ bgcolor: 'grey.50' }}>
          <DialogTitle id="delete-client-dialog-title">Are you sure?</DialogTitle>
        </Box>
        <Divider />
        <DialogContent>
          <DialogContentText>
            Delete client &quot;{clientToDelete?.name}&quot;? This will permanently delete the client and all their projects, phases, activities and assignments. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClientToDelete(null)} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => clientToDelete && deleteMutation.mutate(clientToDelete.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
