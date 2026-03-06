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
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
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
  inactive?: boolean;
  role?: 'admin' | 'user';
};

async function fetchConsultants() {
  const { data, error } = await supabase
    .from('consultants')
    .select('*')
    .order('inactive', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  const raw = (data ?? []) as Record<string, unknown>[];
  return raw.map((row) => normalizeConsultantRow(row)) as Consultant[];
}

function normalizeConsultantRow(row: Record<string, unknown>): Consultant {
  const num = (v: unknown): number => {
    if (v == null || v === '') return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    cost_per_hour: num(row.cost_per_hour),
    charge_out_rate: num(row.charge_out_rate),
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
    color: row.color != null ? String(row.color) : null,
    inactive: Boolean(row.inactive),
    user_id: row.user_id != null ? String(row.user_id) : null,
    role: row.role === 'admin' ? 'admin' : 'user',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

async function createConsultant(input: ConsultantForm & { color?: string }) {
  const { color, ...rest } = input;
  const payload: Record<string, unknown> = {
    ...rest,
    inactive: rest.inactive ?? false,
    role: rest.role ?? 'user',
  };
  if (color) payload.color = color;
  const { data, error } = await supabase
    .from('consultants')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as Consultant;
}

async function updateConsultant(id: string, input: ConsultantForm & { inactive?: boolean; role?: 'admin' | 'user' }) {
  const payload: Record<string, unknown> = {
    name: input.name,
    cost_per_hour: input.cost_per_hour,
    charge_out_rate: input.charge_out_rate,
    ...(input.inactive !== undefined && { inactive: input.inactive }),
    ...(input.role !== undefined && { role: input.role }),
  };
  const { data, error } = await supabase
    .from('consultants')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Consultant;
}

export function ConsultantsPage() {
  const queryClient = useQueryClient();
  const { isAdmin, profileLoading, user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: consultants = [], isLoading } = useQuery({
    queryKey: ['consultants', user?.id],
    queryFn: fetchConsultants,
  });

  const showAdminColumns = !profileLoading && isAdmin;

  const createMutation = useMutation({
    mutationFn: createConsultant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
      setModalOpen(false);
      reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConsultantForm & { inactive?: boolean; role?: 'admin' | 'user' } }) => updateConsultant(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
      setModalOpen(false);
      setEditingId(null);
      reset();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'user' }) => {
      const { data, error } = await supabase
        .from('consultants')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Consultant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
    },
  });

  const { data: authUsers = [] } = useQuery({
    queryKey: ['auth-users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_auth_users');
      if (error) throw error;
      return (data ?? []) as { id: string; email: string | null }[];
    },
    enabled: showAdminColumns,
  });

  const linkUserMutation = useMutation({
    mutationFn: async ({ consultantId, userId }: { consultantId: string; userId: string | null }) => {
      const { error } = await supabase.rpc('link_consultant_to_user', {
        p_consultant_id: consultantId,
        p_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants'] });
      queryClient.invalidateQueries({ queryKey: ['auth-users'] });
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ConsultantForm>({
    resolver: zodResolver(consultantSchema) as import('react-hook-form').Resolver<ConsultantForm>,
    defaultValues: { name: '', cost_per_hour: 0, charge_out_rate: 0, inactive: false, role: 'user' },
  });

  const openCreate = () => {
    setEditingId(null);
    reset({ name: '', cost_per_hour: 0, charge_out_rate: 0, inactive: false, role: 'user' });
    setModalOpen(true);
  };

  const openEdit = (row: Consultant) => {
    setEditingId(row.id);
    setValue('name', row.name);
    setValue('cost_per_hour', row.cost_per_hour);
    setValue('charge_out_rate', row.charge_out_rate);
    setValue('inactive', !!row.inactive);
    setValue('role', row.role ?? 'user');
    setModalOpen(true);
  };

  const onSubmit = (data: ConsultantForm) => {
    if (editingId) updateMutation.mutate({ id: editingId, input: { ...data, inactive: data.inactive, role: data.role } });
    else {
      const color = CONSULTANT_COLORS[consultants.length % CONSULTANT_COLORS.length];
      createMutation.mutate({ ...data, color, inactive: false, role: data.role ?? 'user' });
    }
  };

  const columns: GridColDef<Consultant>[] = [
    {
      field: 'inactive',
      headerName: 'Active',
      width: 80,
      sortable: false,
      renderCell: ({ row }) => (
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center' }}>
          <Checkbox
            checked={!row.inactive}
            onChange={() => {
              updateMutation.mutate({
                id: row.id,
                input: {
                  name: row.name,
                  cost_per_hour: row.cost_per_hour,
                  charge_out_rate: row.charge_out_rate,
                  inactive: !row.inactive,
                },
              });
            }}
            disabled={updateMutation.isPending}
            size="small"
          />
        </Box>
      ),
    },
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
    ...(showAdminColumns
      ? [
          {
            field: 'role',
            headerName: 'Role',
            width: 120,
            sortable: true,
            align: 'center' as const,
            headerAlign: 'center' as const,
            valueGetter: (_value: unknown, row: Consultant) => row.role ?? 'user',
            renderCell: ({ row }: { row: Consultant }) => (
              <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', minHeight: 65, minWidth: 100 }}>
                <FormControl size="small" fullWidth>
                  <Select
                    value={row.role ?? 'user'}
                    onChange={(e) => {
                      const v = e.target.value as 'admin' | 'user';
                      updateRoleMutation.mutate({ id: row.id, role: v });
                    }}
                    disabled={updateRoleMutation.isPending}
                    displayEmpty
                    sx={{ height: 36, fontSize: '0.875rem' }}
                  >
                    <MenuItem value="user">User</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            ),
          },
          {
            field: 'cost_per_hour',
            headerName: 'Cost/hour',
            width: 120,
            type: 'number' as const,
            valueGetter: (value: unknown) => (value != null && value !== '' ? Number(value) : 0),
            valueFormatter: (v: unknown) => (v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '$0.00'),
          },
          {
            field: 'charge_out_rate',
            headerName: 'Charge out/hour',
            width: 140,
            type: 'number' as const,
            valueGetter: (value: unknown) => (value != null && value !== '' ? Number(value) : 0),
            valueFormatter: (v: unknown) => (v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '$0.00'),
          },
          {
            field: 'user_id',
            headerName: 'Linked user',
            width: 220,
            sortable: false,
            valueGetter: (_value: unknown, row: Consultant) => row.user_id ?? '',
            renderCell: ({ row }: { row: Consultant }) => (
              <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', minHeight: 65, width: '100%' }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>User</InputLabel>
                  <Select
                    value={row.user_id ?? ''}
                    label="User"
                    onChange={(e) => {
                      const val = e.target.value as string;
                      const userId = val === '' ? null : val;
                      linkUserMutation.mutate({ consultantId: row.id, userId });
                    }}
                    disabled={linkUserMutation.isPending}
                  >
                    <MenuItem value="">
                      <em>Not linked</em>
                    </MenuItem>
                    {authUsers.map((u) => (
                      <MenuItem key={u.id} value={u.id}>
                        {u.email ?? u.id}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            ),
          },
        ]
      : []),
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
          getRowHeight={() => 65}
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
          <DialogContent sx={{ pt: 4, '& .MuiFormControl-root': { marginBottom: 4 } }}>
            {editingId && (
              <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
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
              autoFocus
            />
            {showAdminColumns && (
              <>
                <TextField
                  {...register('cost_per_hour')}
                  label="Cost per hour ($)"
                  type="number"
                  inputProps={{ step: 0.01, min: 0 }}
                  fullWidth
                  error={!!errors.cost_per_hour}
                  helperText={errors.cost_per_hour?.message}
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
                <FormControl fullWidth>
                  <InputLabel>Role</InputLabel>
                  <Select
                    value={watch('role') ?? 'user'}
                    label="Role"
                    onChange={(e) => setValue('role', e.target.value as 'admin' | 'user')}
                  >
                    <MenuItem value="user">User</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}
            {editingId && (
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() used intentionally
                  checked={!!watch('inactive')}
                  onChange={(e) => setValue('inactive', e.target.checked)}
                />
                <Typography variant="body2">Inactive</Typography>
              </Box>
            )}
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
