import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  IconButton,
  MenuItem,
  Menu,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  Autocomplete,
  CircularProgress,
  Avatar,
  Alert,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { ArrowBack as BackIcon, Delete as DeleteIcon, Save as SaveIcon, ContentCopy as CopyIcon, DragIndicator as DragIcon, Settings as SettingsIcon, Edit as EditIcon } from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import type { Project, Phase, Activity, ActivityAssignment, Consultant, PhaseWithActivitiesDisplay, ActivityWithAssignmentsDisplay } from '../types/database';
import type { ProjectConsultantRate } from '../types/database';
import { computeFinancialSummary, roundCurrency } from '../lib/calculations';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || name.slice(0, 2).toUpperCase() || '?';
}

async function fetchProjectDetail(projectId: string) {
  try {
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*, client:clients(id, name)')
      .eq('id', projectId)
      .single();
    if (projErr || !project) throw new Error(projErr?.message ?? 'Project not found');

    const { data: phases } = await supabase
      .from('phases')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order');
    const phaseList = (phases ?? []) as Phase[];
    if (phaseList.length === 0) {
      return { project: { ...project, phases: [] } as Project & { client?: { id: string; name: string }; phases: PhaseWithActivitiesDisplay[] } };
    }

    const phaseIds = phaseList.map((p) => p.id);
    const { data: activities } = await supabase
      .from('activities')
      .select('*')
      .in('phase_id', phaseIds)
      .order('sort_order');
    const activitiesList = (activities ?? []) as Activity[];
    if (activitiesList.length === 0) {
      const phasesWithActivities: PhaseWithActivitiesDisplay[] = phaseList.map((ph) => ({ ...ph, activities: [] }));
      return {
        project: { ...project, phases: phasesWithActivities } as Project & {
          client?: { id: string; name: string };
          phases: PhaseWithActivitiesDisplay[];
        },
      };
    }

    const activityIds = activitiesList.map((a) => a.id);
    const [assignmentsRes, consultantsRes] = await Promise.all([
      supabase.from('activity_assignments').select('*').in('activity_id', activityIds),
      (async () => {
        const { data: asn } = await supabase.from('activity_assignments').select('consultant_id').in('activity_id', activityIds);
        const cIds = [...new Set((asn ?? []).map((a: { consultant_id: string | null }) => a.consultant_id).filter(Boolean))] as string[];
        if (cIds.length === 0) return { data: [] };
        return supabase.from('consultants').select('*').in('id', cIds);
      })(),
    ]);
    const assignmentsList = (assignmentsRes.data ?? []) as ActivityAssignment[];
    const consultantsList = (consultantsRes.data ?? []) as Consultant[];
    const consultantMap = new Map(consultantsList.map((c) => [c.id, c]));

    const assignmentsByActivity = new Map<string, (ActivityAssignment & { consultant?: Consultant })[]>();
    for (const a of assignmentsList) {
      const list = assignmentsByActivity.get(a.activity_id) ?? [];
      list.push({ ...a, consultant: a.consultant_id != null ? consultantMap.get(a.consultant_id) : undefined });
      assignmentsByActivity.set(a.activity_id, list);
    }
    for (const list of assignmentsByActivity.values()) {
      list.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));
    }

    const activitiesByPhase = new Map<string, ActivityWithAssignmentsDisplay[]>();
    for (const act of activitiesList) {
      const list = activitiesByPhase.get(act.phase_id) ?? [];
      list.push({ ...act, assignments: assignmentsByActivity.get(act.id) ?? [] });
      activitiesByPhase.set(act.phase_id, list);
    }

    const phasesWithActivities: PhaseWithActivitiesDisplay[] = phaseList.map((ph) => ({ ...ph, activities: activitiesByPhase.get(ph.id) ?? [] }));

    return {
      project: { ...project, phases: phasesWithActivities } as Project & {
        client?: { id: string; name: string };
        phases: PhaseWithActivitiesDisplay[];
      },
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

type FlatRow = {
  assignmentId: string | null;
  phaseId: string;
  phaseName: string;
  activityId: string;
  activityName: string;
  consultantId: string;
  consultantName: string;
  consultantAvatarUrl: string | null;
  consultantColor: string | null;
  hours: number;
  sortOrder: number;
};

function flattenProjectToRows(project: { phases?: PhaseWithActivitiesDisplay[] }): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const phase of project.phases ?? []) {
    for (const activity of phase.activities ?? []) {
        for (const a of activity.assignments ?? []) {
          rows.push({
            assignmentId: a.id,
            phaseId: phase.id,
            phaseName: phase.name,
            activityId: activity.id,
            activityName: activity.name,
            consultantId: a.consultant_id ?? '',
            consultantName: a.consultant?.name ?? '—',
            consultantAvatarUrl: a.consultant?.avatar_url ?? null,
            consultantColor: a.consultant?.color ?? null,
            hours: a.hours,
            sortOrder: a.sort_order ?? 0,
          });
        }
    }
  }
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

function SortableActivityRow({
  id,
  row,
  cost,
  revenue,
  isFirstInPhase,
  isEditingHours,
  editingHours,
  setEditingHours,
  onUpdateHours,
  onEditActivity,
  onDuplicate,
  onDelete,
}: {
  id: string;
  row: FlatRow;
  cost: number;
  revenue: number;
  isFirstInPhase: boolean;
  isEditingHours: boolean;
  editingHours: { id: string; value: string } | null;
  setEditingHours: (v: { id: string; value: string } | null) => void;
  onUpdateHours: (id: string, hours: number) => void;
  onEditActivity: (row: FlatRow) => void;
  onDuplicate: (row: FlatRow) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      sx={{ bgcolor: isDragging ? 'action.hover' : undefined, '& .MuiTableCell-root': { verticalAlign: 'middle' } }}
    >
      <TableCell sx={{ width: 40, p: 0.5, cursor: isDragging ? 'grabbing' : 'grab' }} {...listeners} {...attributes}>
        <DragIcon fontSize="small" color="action" />
      </TableCell>
      <TableCell sx={isFirstInPhase ? { fontWeight: 700 } : undefined}>{row.phaseName}</TableCell>
      <TableCell>{row.activityName}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: row.consultantColor ?? 'primary.main' }}>
            {getInitials(row.consultantName)}
          </Avatar>
          {row.consultantName}
        </Box>
      </TableCell>
      <TableCell align="center">
        {isEditingHours && editingHours ? (
          <TextField
            type="number"
            size="small"
            value={editingHours.value}
            inputProps={{ min: 0, step: 0.5 }}
            sx={{ width: 80 }}
            autoFocus
            onBlur={() => {
              const n = Number(editingHours.value);
              if (!Number.isNaN(n) && n >= 0) onUpdateHours(row.assignmentId!, n);
              setEditingHours(null);
            }}
            onChange={(e) => setEditingHours({ id: row.assignmentId!, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(editingHours.value);
                if (!Number.isNaN(n) && n >= 0) onUpdateHours(row.assignmentId!, n);
                setEditingHours(null);
              }
            }}
          />
        ) : (
          <Box
            component="span"
            onClick={() => setEditingHours({ id: row.assignmentId!, value: String(row.hours) })}
            sx={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            {row.hours}
          </Box>
        )}
      </TableCell>
      <TableCell align="right">${roundCurrency(cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
      <TableCell align="right">${roundCurrency(revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
          <IconButton size="small" onClick={() => onEditActivity(row)} title="Edit activity" sx={{ p: 0.75 }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDuplicate(row)} title="Duplicate row" sx={{ p: 0.75 }}>
            <CopyIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(row.assignmentId!)} title="Delete row" sx={{ p: 0.75 }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </TableCell>
    </TableRow>
  );
}

export function ProjectDetailPage() {
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [projectNameEdit, setProjectNameEdit] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<{
    phaseId: string;
    phaseNameNew: string;
    activityId: string;
    activityNameNew: string;
    consultantId: string;
    hours: string;
  }>({
    phaseId: '',
    phaseNameNew: '',
    activityId: '',
    activityNameNew: '',
    consultantId: '',
    hours: '',
  });
  const [editingHours, setEditingHours] = useState<{ id: string; value: string } | null>(null);
  const [activityToEdit, setActivityToEdit] = useState<{
    assignmentId: string;
    activityId: string;
    activityName: string;
    phaseId: string;
    phaseName: string;
    consultantId: string;
    hours: number;
  } | null>(null);
  const [addRowError, setAddRowError] = useState<string | null>(null);
  const [rateOverrideInputs, setRateOverrideInputs] = useState<Record<string, string>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [detailTab, setDetailTab] = useState(0);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: (): Promise<{ project: Project & { client?: { id: string; name: string }; phases: PhaseWithActivitiesDisplay[] } }> =>
      fetchProjectDetail(projectId!),
    enabled: !!projectId,
  });

  const { data: consultants = [] } = useQuery({
    queryKey: ['consultants'],
    queryFn: async () => {
      const { data: d, error } = await supabase.from('consultants').select('*').order('name');
      if (error) throw error;
      return (d ?? []) as Consultant[];
    },
  });

  const { data: rateOverrides = [] } = useQuery({
    queryKey: ['project-consultant-rates', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_consultant_rates')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as ProjectConsultantRate[];
    },
    enabled: !!projectId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    queryClient.invalidateQueries({ queryKey: ['project-consultant-rates', projectId] });
  }, [queryClient, projectId, clientId]);

  const updateProjectMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('projects').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createPhaseMutation = useMutation({
    mutationFn: async ({ project_id, name }: { project_id: string; name: string }) => {
      const { count } = await supabase.from('phases').select('*', { count: 'exact', head: true }).eq('project_id', project_id);
      const { data, error } = await supabase.from('phases').insert({ project_id, name, sort_order: count ?? 0 }).select('id').single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => invalidate(),
  });

  const createActivityMutation = useMutation({
    mutationFn: async ({ phase_id, name }: { phase_id: string; name: string }) => {
      const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('phase_id', phase_id);
      const { data, error } = await supabase.from('activities').insert({ phase_id, name, sort_order: count ?? 0 }).select('id').single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => invalidate(),
  });

  const updateActivityMutation = useMutation({
    mutationFn: async ({ id, name, phase_id }: { id: string; name: string; phase_id?: string }) => {
      const payload: { name: string; phase_id?: string } = { name };
      if (phase_id !== undefined) payload.phase_id = phase_id;
      const { error } = await supabase.from('activities').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const createAssignmentMutation = useMutation({
    mutationFn: async ({
      activity_id,
      consultant_id,
      hours,
      sort_order,
    }: {
      activity_id: string;
      consultant_id: string;
      hours: number;
      sort_order?: number;
    }) => {
      const payload: { activity_id: string; consultant_id: string; hours: number; sort_order?: number } = {
        activity_id,
        consultant_id,
        hours,
      };
      if (sort_order !== undefined) payload.sort_order = sort_order;
      const { data, error } = await supabase.from('activity_assignments').insert(payload).select().single();
      if (error) throw error;
      return data as ActivityAssignment;
    },
    onSuccess: (newAssignment) => {
      if (!projectId || !newAssignment) return;
      const consultants = queryClient.getQueryData<Consultant[]>(['consultants']) ?? [];
      const consultant = consultants.find((c) => c.id === newAssignment.consultant_id);
      const fullAssignment = { ...newAssignment, consultant };
      queryClient.setQueryData(['project', projectId], (old: Awaited<ReturnType<typeof fetchProjectDetail>> | undefined) => {
        const project = old?.project;
        if (!project?.phases) return old;
        return {
          ...old,
          project: {
            ...project,
            phases: project.phases.map((phase: PhaseWithActivitiesDisplay) => ({
              ...phase,
              activities: phase.activities?.map((act: ActivityWithAssignmentsDisplay) =>
                act.id === newAssignment.activity_id
                  ? {
                      ...act,
                      assignments: [...(act.assignments ?? []), fullAssignment].sort(
                        (a: ActivityAssignment & { consultant?: Consultant }, b: ActivityAssignment & { consultant?: Consultant }) =>
                          (a.sort_order ?? 0) - (b.sort_order ?? 0)
                      ),
                    }
                  : act
              ) ?? phase.activities,
            })),
          },
        };
      });
      queryClient.invalidateQueries({ queryKey: ['project-consultant-rates', projectId] });
      setNewRow({ phaseId: '', phaseNameNew: '', activityId: '', activityNameNew: '', consultantId: '', hours: '' });
    },
  });

  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ id, hours, consultant_id }: { id: string; hours: number; consultant_id?: string | null }) => {
      const payload: { hours: number; consultant_id?: string | null } = { hours };
      if (consultant_id !== undefined) payload.consultant_id = consultant_id;
      const { error } = await supabase.from('activity_assignments').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setEditingHours(null);
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('activity_assignments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const duplicateAssignmentMutation = useMutation({
    mutationFn: async ({
      activity_id,
      hours,
      insert_after_sort_order,
    }: {
      activity_id: string;
      hours: number;
      insert_after_sort_order: number;
    }) => {
      const newSortOrder = insert_after_sort_order + 1;
      const { data: existing } = await supabase
        .from('activity_assignments')
        .select('id, sort_order')
        .eq('activity_id', activity_id)
        .gte('sort_order', newSortOrder)
        .order('sort_order', { ascending: true });
      if (existing?.length) {
        for (let i = existing.length - 1; i >= 0; i--) {
          const { error } = await supabase
            .from('activity_assignments')
            .update({ sort_order: (existing[i].sort_order ?? 0) + 1 })
            .eq('id', existing[i].id);
          if (error) throw error;
        }
      }
      const { error } = await supabase.from('activity_assignments').insert({
        activity_id,
        consultant_id: null,
        hours,
        sort_order: newSortOrder,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorderAssignmentsMutation = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      for (const { id, sort_order } of updates) {
        const { error } = await supabase.from('activity_assignments').update({ sort_order }).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const saveRateOverrideMutation = useMutation({
    mutationFn: async ({
      project_id,
      consultant_id,
      charge_out_rate,
    }: {
      project_id: string;
      consultant_id: string;
      charge_out_rate: number;
    }) => {
      const { error } = await supabase.from('project_consultant_rates').upsert(
        { project_id, consultant_id, charge_out_rate, updated_at: new Date().toISOString() },
        { onConflict: 'project_id,consultant_id' }
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const clearRateOverrideMutation = useMutation({
    mutationFn: async ({ project_id, consultant_id }: { project_id: string; consultant_id: string }) => {
      const { error } = await supabase
        .from('project_consultant_rates')
        .delete()
        .eq('project_id', project_id)
        .eq('consultant_id', consultant_id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      navigate(`/clients/${clientId}`);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const project = data?.project;
  const rows = project ? flattenProjectToRows(project) : [];
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const dataRows = rows.filter((r) => r.assignmentId);
    const oldIndex = dataRows.findIndex((r) => r.assignmentId === active.id);
    const newIndex = dataRows.findIndex((r) => r.assignmentId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(dataRows, oldIndex, newIndex);
    const updates = reordered.map((r, i) => ({ id: r.assignmentId!, sort_order: i }));
    reorderAssignmentsMutation.mutate(updates);
  };

  if (!projectId || !clientId) {
    navigate('/clients');
    return null;
  }

  if (isLoading || (!data && !isError)) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ maxWidth: 1600, width: '100%' }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate(`/clients/${clientId}`)} sx={{ mb: 2 }}>
          Back to client
        </Button>
        <Typography color="error">Failed to load project. {(error as Error)?.message ?? 'Please try again.'}</Typography>
      </Box>
    );
  }

  if (!data?.project) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  const projectData = data.project;
  const phases = projectData.phases ?? [];
  const allAssignments: { hours: number; consultant: Consultant }[] = [];
  for (const phase of phases) {
    for (const activity of phase.activities ?? []) {
      for (const a of activity.assignments ?? []) {
        if (a.consultant) allAssignments.push({ hours: a.hours, consultant: a.consultant });
      }
    }
  }
  const chargeOutOverridesMap = new Map<string, number>(
    rateOverrides.map((r) => [r.consultant_id, r.charge_out_rate])
  );
  const summary = computeFinancialSummary(allAssignments, chargeOutOverridesMap);
  const revenueTotal = summary.revenue;

  const getChargeRate = (consultant: Consultant) =>
    chargeOutOverridesMap.get(consultant.id) ?? consultant.charge_out_rate;

  const projectConsultants = [...new Map(allAssignments.map((a) => [a.consultant.id, a.consultant])).values()];
  const handleSaveRateOverrides = async () => {
    setSavingOverrides(true);
    try {
      for (const c of projectConsultants) {
        const raw = rateOverrideInputs[c.id] ?? rateOverrides.find((r) => r.consultant_id === c.id)?.charge_out_rate ?? '';
        const num = raw === '' ? NaN : Number(raw);
        const hasOverride = rateOverrides.some((r) => r.consultant_id === c.id);
        if (!Number.isNaN(num) && num >= 0) {
          await saveRateOverrideMutation.mutateAsync({ project_id: projectId!, consultant_id: c.id, charge_out_rate: num });
        } else if (hasOverride) {
          await clearRateOverrideMutation.mutateAsync({ project_id: projectId!, consultant_id: c.id });
        }
      }
    } finally {
      setSavingOverrides(false);
    }
  };

  const handleDuplicateRow = (row: FlatRow) => {
    if (!row.assignmentId) return;
    duplicateAssignmentMutation.mutate({
      activity_id: row.activityId,
      hours: row.hours,
      insert_after_sort_order: row.sortOrder,
    });
  };

  const handleCopyTableToWord = async () => {
    const headers = ['Phase', 'Activity', 'Revenue'];
    const headerRow = '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const dataRows = rows
      .filter((r) => r.assignmentId)
      .map((row) => {
        const consultant = consultants.find((c) => c.id === row.consultantId);
        const revenue = consultant ? row.hours * getChargeRate(consultant) : 0;
        return `<tr><td>${row.phaseName}</td><td>${row.activityName}</td><td>${roundCurrency(revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`;
      })
      .join('');
    const totalRow = `<tr><td colspan="2"><strong>Total - Excludes GST and project related expenses</strong></td><td><strong>${roundCurrency(revenueTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td></tr>`;
    const html = `<table border="1" cellpadding="4" cellspacing="0"><thead>${headerRow}</thead><tbody>${dataRows}${totalRow}</tbody></table>`;
    const plain = [
      headers.join('\t'),
      ...rows.filter((r) => r.assignmentId).map((row) => {
        const consultant = consultants.find((c) => c.id === row.consultantId);
        const revenue = consultant ? row.hours * getChargeRate(consultant) : 0;
        return [row.phaseName, row.activityName, roundCurrency(revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })].join('\t');
      }),
      ['Total - Excludes GST and project related expenses', '', roundCurrency(revenueTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })].join('\t'),
    ].join('\n');
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
    ]);
  };

  const handleSaveProjectName = () => {
    const name = (projectNameEdit ?? '').trim();
    if (name && name !== projectData.name) updateProjectMutation.mutate({ id: projectId, name });
    setProjectNameEdit(null);
  };

  const handleAddRow = async () => {
    setAddRowError(null);
    const hours = Number(newRow.hours);
    if (!newRow.consultantId || Number.isNaN(hours) || hours < 0) {
      setAddRowError('Select a consultant and enter valid hours.');
      return;
    }

    let phaseId = newRow.phaseId;
    if (!phaseId && newRow.phaseNameNew.trim()) {
      const existing = phases.find((p) => p.name.toLowerCase() === newRow.phaseNameNew.trim().toLowerCase());
      if (existing) phaseId = existing.id;
      else {
        try {
          const created = await createPhaseMutation.mutateAsync({ project_id: projectId!, name: newRow.phaseNameNew.trim() });
          phaseId = created.id;
        } catch (e) {
          setAddRowError(e instanceof Error ? e.message : 'Failed to create phase');
          return;
        }
      }
    }
    if (!phaseId) {
      setAddRowError('Select or enter a phase.');
      return;
    }

    let activityId = newRow.activityId;
    const phase = phases.find((p) => p.id === phaseId);
    const activitiesInPhase = phase?.activities ?? [];
    if (!activityId && newRow.activityNameNew.trim()) {
      const existing = activitiesInPhase.find((a: ActivityWithAssignmentsDisplay) => a.name.toLowerCase() === newRow.activityNameNew.trim().toLowerCase());
      if (existing) activityId = existing.id;
      else {
        try {
          const created = await createActivityMutation.mutateAsync({ phase_id: phaseId, name: newRow.activityNameNew.trim() });
          activityId = created.id;
        } catch (e) {
          setAddRowError(e instanceof Error ? e.message : 'Failed to create activity');
          return;
        }
      }
    }
    if (!activityId) {
      setAddRowError('Select or enter an activity.');
      return;
    }

    const nextSortOrder = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.sortOrder), 0) + 1;
    try {
      await createAssignmentMutation.mutateAsync({
        activity_id: activityId,
        consultant_id: newRow.consultantId,
        hours,
        sort_order: nextSortOrder,
      });
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      const msg = err?.message ?? String(e);
      if (msg.includes('unique') || msg.includes('duplicate') || err?.code === '23505') {
        setAddRowError('This consultant is already assigned to this activity.');
      } else {
        setAddRowError(msg || 'Failed to save row');
      }
    }
  };

  const phaseOptions = phases.map((p) => p.name);
  const selectedPhaseId = newRow.phaseId || (newRow.phaseNameNew && phases.find((p) => p.name.toLowerCase() === newRow.phaseNameNew.trim().toLowerCase())?.id);
  const activityOptions = (phases.find((p) => p.id === selectedPhaseId)?.activities ?? []).map((a: ActivityWithAssignmentsDisplay) => a.name);
  const canSave =
    (newRow.phaseId || newRow.phaseNameNew.trim()) &&
    (newRow.activityId || newRow.activityNameNew.trim()) &&
    newRow.consultantId &&
    newRow.hours !== '' &&
    !Number.isNaN(Number(newRow.hours)) &&
    Number(newRow.hours) >= 0;

  const activitiesForPhase = (phaseId: string): ActivityWithAssignmentsDisplay[] =>
    phases.find((p) => p.id === phaseId)?.activities ?? [];

  return (
    <Box sx={{ maxWidth: 1600, width: '100%' }}>
      <Button startIcon={<BackIcon />} onClick={() => navigate(`/clients/${clientId}`)} sx={{ mb: 2 }}>
        Back to client
      </Button>

      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          {projectNameEdit !== null ? (
            <TextField
              value={projectNameEdit}
              onChange={(e) => setProjectNameEdit(e.target.value)}
              onBlur={handleSaveProjectName}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveProjectName()}
              variant="standard"
              sx={{ '& .MuiInput-input': { fontSize: '2rem', fontWeight: 600 } }}
              autoFocus
            />
          ) : (
            <Typography variant="h4" fontWeight={600} onClick={() => setProjectNameEdit(projectData.name)} sx={{ cursor: 'text' }}>
              {projectData.name}
            </Typography>
          )}
        </Box>
        <IconButton
          aria-label="Project settings"
          onClick={(e) => setSettingsAnchor(e.currentTarget)}
          sx={{ flexShrink: 0 }}
        >
          <SettingsIcon />
        </IconButton>
      </Box>

      <Menu
        anchorEl={settingsAnchor}
        open={!!settingsAnchor}
        onClose={() => setSettingsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            setSettingsAnchor(null);
            setDeleteProjectConfirmOpen(true);
          }}
          sx={{ color: 'error.main' }}
        >
          Delete project
        </MenuItem>
      </Menu>

      <Dialog
        open={deleteProjectConfirmOpen}
        onClose={() => !deleteProjectMutation.isPending && setDeleteProjectConfirmOpen(false)}
        aria-labelledby="delete-project-dialog-title"
      >
        <DialogTitle id="delete-project-dialog-title">Delete project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the project &quot;{projectData.name}&quot; and all its phases, activities and assignments. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteProjectConfirmOpen(false)} disabled={deleteProjectMutation.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => projectId && deleteProjectMutation.mutate(projectId)}
            disabled={deleteProjectMutation.isPending}
          >
            {deleteProjectMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!activityToEdit}
        onClose={() => !updateActivityMutation.isPending && !updateAssignmentMutation.isPending && setActivityToEdit(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit row</DialogTitle>
        <DialogContent sx={{ pt: 0, '& .MuiFormControl-root': { marginBottom: 2 } }}>
          <Autocomplete
            size="small"
            options={phases}
            getOptionLabel={(p) => p.name}
            value={phases.find((p) => p.id === activityToEdit?.phaseId) ?? null}
            onChange={(_, value) => setActivityToEdit((a) => (a && value ? { ...a, phaseId: value.id, phaseName: value.name } : a))}
            renderInput={(params) => <TextField {...params} label="Phase" />}
          />
          <TextField
            fullWidth
            label="Activity name"
            value={activityToEdit?.activityName ?? ''}
            onChange={(e) => setActivityToEdit((a) => (a ? { ...a, activityName: e.target.value } : null))}
          />
          <Autocomplete
            size="small"
            options={consultants}
            getOptionLabel={(c) => c.name}
            value={consultants.find((c) => c.id === activityToEdit?.consultantId) ?? null}
            onChange={(_, value) => setActivityToEdit((a) => (a ? { ...a, consultantId: value?.id ?? '' } : null))}
            renderInput={(params) => <TextField {...params} label="Consultant" />}
          />
          <TextField
            fullWidth
            type="number"
            label="Hours"
            value={activityToEdit?.hours ?? ''}
            onChange={(e) => setActivityToEdit((a) => (a ? { ...a, hours: Number(e.target.value) || 0 } : null))}
            inputProps={{ min: 0, step: 0.5 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setActivityToEdit(null)} disabled={updateActivityMutation.isPending || updateAssignmentMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!activityToEdit) return;
              updateActivityMutation.mutate(
                { id: activityToEdit.activityId, name: activityToEdit.activityName, phase_id: activityToEdit.phaseId },
                {
                  onSuccess: () => {
                    updateAssignmentMutation.mutate(
                      { id: activityToEdit.assignmentId, hours: activityToEdit.hours, consultant_id: activityToEdit.consultantId || null },
                      { onSuccess: () => setActivityToEdit(null) }
                    );
                  },
                }
              );
            }}
            disabled={!activityToEdit?.activityName.trim() || !activityToEdit?.phaseId || updateActivityMutation.isPending || updateAssignmentMutation.isPending}
          >
            {(updateActivityMutation.isPending || updateAssignmentMutation.isPending) ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 2, mb: 3, maxWidth: 1600 }}>
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Cost</Typography>
            <Typography variant="h6">${roundCurrency(summary.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Revenue</Typography>
            <Typography variant="h6">${roundCurrency(summary.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Profit</Typography>
            <Typography variant="h6" color={summary.profit >= 0 ? 'success.main' : 'error.main'}>
              ${roundCurrency(summary.profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Margin</Typography>
            <Typography variant="h6" color={summary.marginPercent >= 0 ? 'success.main' : 'error.main'}>
              {summary.marginPercent.toFixed(1)}%
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Card sx={{ maxWidth: 1600 }}>
        <Tabs
          value={detailTab}
          onChange={(_, v) => setDetailTab(v)}
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
            pt: 1.5,
            pb: 0,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 },
          }}
        >
          <Tab label="Project Activities" id="detail-tab-0" aria-controls="detail-tabpanel-0" />
          <Tab label="Rate Overrides" id="detail-tab-1" aria-controls="detail-tabpanel-1" />
        </Tabs>
        <CardContent sx={{ pt: 2 }}>
          <Box role="tabpanel" id="detail-tabpanel-0" aria-labelledby="detail-tab-0" hidden={detailTab !== 0}>
            {detailTab === 0 && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={handleCopyTableToWord}
                  >
                    Copy
                  </Button>
                </Box>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
            <TableHead>
              <TableRow sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
                <TableCell sx={{ width: 40 }} />
                <TableCell sx={{ fontWeight: 700 }}>Phase</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Activity</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Consultant</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>Hours</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Revenue</TableCell>
                <TableCell width={100} />
              </TableRow>
            </TableHead>
            <TableBody>
              <SortableContext
                items={rows.filter((r) => r.assignmentId).map((r) => r.assignmentId!)}
                strategy={verticalListSortingStrategy}
              >
              {(() => {
                const dataRows = rows.filter((r) => r.assignmentId);
                return dataRows.map((row, dataIndex) => {
                  const consultant = consultants.find((c) => c.id === row.consultantId);
                  const cost = consultant ? row.hours * consultant.cost_per_hour : 0;
                  const revenue = consultant ? row.hours * getChargeRate(consultant) : 0;
                  const isEditingHoursRow = editingHours?.id === row.assignmentId;
                  const isFirstInPhase = dataIndex === 0 || dataRows[dataIndex - 1].phaseId !== row.phaseId;
                  return (
                    <SortableActivityRow
                      key={row.assignmentId}
                      id={row.assignmentId!}
                      row={row}
                      cost={cost}
                      revenue={revenue}
                      isFirstInPhase={isFirstInPhase}
                      isEditingHours={!!isEditingHoursRow}
                      editingHours={editingHours}
                      setEditingHours={setEditingHours}
                      onUpdateHours={(id, hours) => updateAssignmentMutation.mutate({ id, hours })}
                      onEditActivity={(row) => setActivityToEdit({
                        assignmentId: row.assignmentId!,
                        activityId: row.activityId,
                        activityName: row.activityName,
                        phaseId: row.phaseId,
                        phaseName: row.phaseName,
                        consultantId: row.consultantId,
                        hours: row.hours,
                      })}
                      onDuplicate={handleDuplicateRow}
                      onDelete={(id) => deleteAssignmentMutation.mutate(id)}
                    />
                  );
                });
              })()}
              </SortableContext>
              <TableRow sx={{ bgcolor: 'grey.100', fontWeight: 700, '& .MuiTableCell-root': { verticalAlign: 'middle', py: 1.5 } }}>
                <TableCell sx={{ py: 1.5 }} />
                <TableCell colSpan={5} sx={{ fontWeight: 700, py: 1.5 }}>Total - Excludes GST and project related expenses</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, py: 1.5 }}>
                  ${roundCurrency(revenueTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell sx={{ py: 1.5 }} />
              </TableRow>
              {addRowError && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 1, verticalAlign: 'middle' }}>
                    <Alert severity="error" onClose={() => setAddRowError(null)}>
                      {addRowError}
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </DndContext>

                {addRowError && (
                  <Alert severity="error" onClose={() => setAddRowError(null)} sx={{ mt: 2 }}>
                    {addRowError}
                  </Alert>
                )}
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    bgcolor: 'secondary.light',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 2,
                    '& .MuiOutlinedInput-root': { backgroundColor: 'background.paper' },
                  }}
                >
                  <Autocomplete
                    size="small"
                    freeSolo
                    options={phaseOptions}
                    value={newRow.phaseId ? (phases.find((p) => p.id === newRow.phaseId)?.name ?? '') : newRow.phaseNameNew}
                    onInputChange={(_, value) => {
                      const existing = phases.find((p) => p.name === value);
                      setNewRow((r) => ({
                        ...r,
                        phaseId: existing?.id ?? '',
                        phaseNameNew: existing ? '' : (value ?? ''),
                        activityId: '',
                        activityNameNew: '',
                      }));
                    }}
                    onChange={(_, value) => {
                      const name = typeof value === 'string' ? value : value ?? '';
                      const existing = phases.find((p) => p.name === name);
                      setNewRow((r) => ({
                        ...r,
                        phaseId: existing?.id ?? '',
                        phaseNameNew: existing ? '' : name,
                        activityId: '',
                        activityNameNew: '',
                      }));
                    }}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Phase (select or type new)" size="small" sx={{ minWidth: 250 }} />
                    )}
                  />
                  <Autocomplete
                    size="small"
                    freeSolo
                    options={activityOptions}
                    value={newRow.activityId
                      ? (activitiesForPhase(selectedPhaseId ?? '').find((a) => a.id === newRow.activityId)?.name ?? '')
                      : newRow.activityNameNew}
                    onInputChange={(_, value) => {
                      const acts = activitiesForPhase(selectedPhaseId ?? '');
                      const existing = acts.find((a: ActivityWithAssignmentsDisplay) => a.name === value);
                      setNewRow((r) => ({
                        ...r,
                        activityId: existing?.id ?? '',
                        activityNameNew: existing ? '' : (value ?? ''),
                      }));
                    }}
                    onChange={(_, value) => {
                      const name = typeof value === 'string' ? value : value ?? '';
                      const acts = activitiesForPhase(selectedPhaseId ?? '');
                      const existing = acts.find((a: ActivityWithAssignmentsDisplay) => a.name === name);
                      setNewRow((r) => ({
                        ...r,
                        activityId: existing?.id ?? '',
                        activityNameNew: existing ? '' : name,
                      }));
                    }}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Activity (select or type new)" size="small" sx={{ minWidth: 250 }} />
                    )}
                    disabled={!selectedPhaseId && !newRow.phaseNameNew.trim()}
                  />
                  <Autocomplete
                    size="small"
                    options={consultants}
                    getOptionLabel={(c) => c.name}
                    value={consultants.find((c) => c.id === newRow.consultantId) ?? null}
                    onChange={(_, value) => setNewRow((r) => ({ ...r, consultantId: value?.id ?? '' }))}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Consultant (type to search)" size="small" sx={{ minWidth: 200 }} />
                    )}
                  />
                  <TextField
                    type="number"
                    size="small"
                    placeholder="Hours"
                    value={newRow.hours}
                    onChange={(e) => setNewRow((r) => ({ ...r, hours: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && canSave && handleAddRow()}
                    inputProps={{ min: 0, step: 0.5 }}
                    sx={{ width: 113 }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={() => handleAddRow()}
                    disabled={!canSave || createAssignmentMutation.isPending || createPhaseMutation.isPending || createActivityMutation.isPending}
                  >
                    Save
                  </Button>
                </Box>
              </>
            )}
          </Box>

          <Box role="tabpanel" id="detail-tabpanel-1" aria-labelledby="detail-tab-1" hidden={detailTab !== 1}>
            {detailTab === 1 && (
              <>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
                  Consultant rate overrides
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Override charge-out rates for this project. Leave blank to use the consultant&apos;s default rate.
                </Typography>
                {projectConsultants.length > 0 ? (
                  <>
                    <Table size="small" sx={{ maxWidth: 480, '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>Consultant</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Default ($/hr)</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Override ($/hr)</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {projectConsultants.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>{c.name}</TableCell>
                            <TableCell align="right">${Number(c.charge_out_rate).toFixed(2)}</TableCell>
                            <TableCell align="right">
                              <TextField
                                type="number"
                                size="small"
                                placeholder="Use default"
                                value={rateOverrideInputs[c.id] ?? rateOverrides.find((r) => r.consultant_id === c.id)?.charge_out_rate ?? ''}
                                onChange={(e) => setRateOverrideInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                inputProps={{ min: 0, step: 0.01 }}
                                sx={{ width: 100 }}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleSaveRateOverrides}
                      disabled={savingOverrides || saveRateOverrideMutation.isPending || clearRateOverrideMutation.isPending}
                      sx={{ mt: 1 }}
                    >
                      {savingOverrides ? 'Saving…' : 'Save overrides'}
                    </Button>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Add activities with consultants to this project to set rate overrides.
                  </Typography>
                )}
              </>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
