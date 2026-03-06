import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  IconButton,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import type { Consultant } from '../types/database';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || name.slice(0, 2).toUpperCase() || '?';
}

const numberFromString = z.union([z.string(), z.number()]).transform((v) =>
  typeof v === 'string' ? (v === '' ? 0 : Number(v)) : v
).pipe(z.number().min(0, 'Must be ≥ 0'));

const CONSULTANT_COLORS = [
  '#6D5CBE', '#B69AF2', '#10b981', '#ef4444', '#f59e0b',
  '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316',
];

const consultantSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  cost_per_hour: numberFromString,
  charge_out_rate: numberFromString,
});

type ConsultantForm = {
  name: string;
  cost_per_hour: number;
  charge_out_rate: number;
};

async function fetchConsultants() {
  const { data, error } = await supabase.from('consultants').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as Consultant[];
}

async function createConsultant(input: ConsultantForm & { color?: string }) {
  const { color, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest };
  if (color) payload.color = color;
  const { data, error } = await supabase
    .from('consultants')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as Consultant;
}

async function updateConsultant(id: string, input: ConsultantForm) {
  const { data, error } = await supabase
    .from('consultants')
    .update({
      name: input.name,
      cost_per_hour: input.cost_per_hour,
      charge_out_rate: input.charge_out_rate,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Consultant;
}

export function ConsultantsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: consultants = [], isLoading } = useQuery({
    queryKey: ['consultants'],
    queryFn: fetchConsultants,
  });

  const createMutation = useMutation({
    mutationFn: createConsultant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
      setModalOpen(false);
      reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConsultantForm }) => updateConsultant(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
      setModalOpen(false);
      setEditingId(null);
      reset();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ConsultantForm>({
    resolver: zodResolver(consultantSchema) as import('react-hook-form').Resolver<ConsultantForm>,
    defaultValues: { name: '', cost_per_hour: 0, charge_out_rate: 0 },
  });

  const openCreate = () => {
    setEditingId(null);
    reset({ name: '', cost_per_hour: 0, charge_out_rate: 0 });
    setModalOpen(true);
  };

  const openEdit = (row: Consultant) => {
    setEditingId(row.id);
    setValue('name', row.name);
    setValue('cost_per_hour', row.cost_per_hour);
    setValue('charge_out_rate', row.charge_out_rate);
    setModalOpen(true);
  };

  const onSubmit = (data: ConsultantForm) => {
    if (editingId) updateMutation.mutate({ id: editingId, input: data });
    else {
      const color = CONSULTANT_COLORS[consultants.length % CONSULTANT_COLORS.length];
      createMutation.mutate({ ...data, color });
    }
  };

  const columns: GridColDef<Consultant>[] = [
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      minWidth: 180,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: row.color ?? 'primary.main',
            }}
          >
            {getInitials(row.name)}
          </Avatar>
          <Typography variant="body2">{row.name}</Typography>
        </Box>
      ),
    },
    {
      field: 'cost_per_hour',
      headerName: 'Cost/hour',
      width: 120,
      type: 'number',
      valueFormatter: (v) => (v != null ? `$${Number(v).toFixed(2)}` : ''),
    },
    {
      field: 'charge_out_rate',
      headerName: 'Charge out/hour',
      width: 140,
      type: 'number',
      valueFormatter: (v) => (v != null ? `$${Number(v).toFixed(2)}` : ''),
    },
    {
      field: 'actions',
      headerName: '',
      width: 80,
      sortable: false,
      renderCell: ({ row }) => (
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'inline-block' }}>
          <IconButton size="small" onClick={() => openEdit(row)} title="Edit">
            <EditIcon fontSize="small" />
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
            Consultants
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage consultants, cost and charge-out rates
          </Typography>
        </div>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add consultant
        </Button>
      </Box>

      <Card>
        <DataGrid
          rows={consultants}
          columns={columns}
          getRowId={(r) => r.id}
          loading={isLoading}
          autoHeight
          onRowClick={({ row }) => openEdit(row)}
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          sx={{
            border: 'none',
            cursor: 'pointer',
            '& .MuiDataGrid-cell:focus': { outline: 'none' },
            '& .MuiDataGrid-cell': { alignItems: 'center', display: 'flex' },
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'grey.50' },
            '& .MuiDataGrid-row:hover': { backgroundColor: 'secondary.light' },
          }}
        />
      </Card>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit consultant' : 'New consultant'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            {editingId && (
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar
                  sx={{
                    width: 64,
                    height: 64,
                    bgcolor: consultants.find((c) => c.id === editingId)?.color ?? 'primary.main',
                  }}
                >
                  {getInitials(consultants.find((c) => c.id === editingId)?.name ?? '')}
                </Avatar>
              </Box>
            )}
            <TextField
              {...register('name')}
              label="Name"
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
              sx={{ mb: 2 }}
              autoFocus
            />
            <TextField
              {...register('cost_per_hour')}
              label="Cost per hour ($)"
              type="number"
              inputProps={{ step: 0.01, min: 0 }}
              fullWidth
              error={!!errors.cost_per_hour}
              helperText={errors.cost_per_hour?.message}
              sx={{ mb: 2 }}
            />
            <TextField
              {...register('charge_out_rate')}
              label="Charge out rate ($)"
              type="number"
              inputProps={{ step: 0.01, min: 0 }}
              fullWidth
              error={!!errors.charge_out_rate}
              helperText={errors.charge_out_rate?.message}
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
