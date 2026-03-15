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
  Chip,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Client } from '../types/database';
type ProjectCounts = { active: number; proposal: number };

async function fetchProjectCountsByClient(clientIds: string[]): Promise<Record<string, ProjectCounts>> {
  if (clientIds.length === 0) return {};
  const { data: projects } = await supabase
    .from('projects')
    .select('client_id, status')
    .in('client_id', clientIds);
  const list = projects ?? [];
  const result: Record<string, ProjectCounts> = {};
  for (const clientId of clientIds) {
    result[clientId] = { active: 0, proposal: 0 };
  }
  for (const p of list) {
    const clientId = p.client_id;
    const status = (p as { status?: string }).status ?? 'proposal';
    if (!result[clientId]) result[clientId] = { active: 0, proposal: 0 };
    if (status === 'active') result[clientId].active += 1;
    else result[clientId].proposal += 1;
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
  const { data: projectCountsByClient = {} } = useQuery({
    queryKey: ['clients', 'project-counts', clientIds],
    queryFn: () => fetchProjectCountsByClient(clientIds),
    enabled: clientIds.length > 0,
  });

  const rows = clients.map((c) => ({
    ...c,
    projectCounts: projectCountsByClient[c.id] ?? { active: 0, proposal: 0 },
  }));

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

  type ClientRow = Client & { projectCounts: ProjectCounts };

  const columns: GridColDef<ClientRow>[] = [
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
    {
      field: 'projectCounts',
      headerName: 'Projects',
      width: 180,
      sortable: false,
      valueGetter: (_: unknown, row: ClientRow) => row.projectCounts,
      renderCell: ({ row }: { row: ClientRow }) => {
        const { active, proposal } = row.projectCounts;
        return (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            {active > 0 && (
              <Chip size="small" label={`${active} active`} color="success" variant="outlined" />
            )}
            {proposal > 0 && (
              <Chip size="small" label={`${proposal} proposal${proposal !== 1 ? 's' : ''}`} variant="outlined" />
            )}
            {active === 0 && proposal === 0 && (
              <Typography variant="body2" color="text.secondary">
                No projects
              </Typography>
            )}
          </Box>
        );
      },
    },
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
