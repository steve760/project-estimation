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
  DialogActions,
  TextField,
  Avatar,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { Add as AddIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import type { Client } from '../types/database';

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

async function fetchClients() {
  const { data, error } = await supabase.from('clients').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as Client[];
}

async function createClient(input: ClientForm) {
  const { data, error } = await supabase.from('clients').insert({ name: input.name }).select().single();
  if (error) throw error;
  return data as Client;
}

async function updateClient(id: string, input: ClientForm) {
  const { data, error } = await supabase.from('clients').update({ name: input.name }).eq('id', id).select().single();
  if (error) throw error;
  return data as Client;
}

export function ClientsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: fetchClients,
  });

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
    else createMutation.mutate(data);
  };

  const columns: GridColDef<Client>[] = [
    {
      field: 'name',
      headerName: 'Client name',
      flex: 1,
      minWidth: 200,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32 }}>
            {getInitials(row.name)}
          </Avatar>
          <Typography variant="body2" fontWeight={400}>
            {row.name}
          </Typography>
        </Box>
      ),
    },
  ];

  return (
    <Box sx={{ maxWidth: 1600, width: '100%', mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <div>
          <Typography variant="h4" fontWeight={600}>
            Clients
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
          rows={clients}
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
        <DialogTitle>{editingId ? 'Edit client' : 'New client'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <TextField
              {...register('name')}
              label="Client name"
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
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
    </Box>
  );
}
