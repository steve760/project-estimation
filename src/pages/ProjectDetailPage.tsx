import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useMemo, useEffect } from 'react';
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
  Tooltip,
  Chip,
  Checkbox,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { Delete as DeleteIcon, Save as SaveIcon, ContentCopy as CopyIcon, DragIndicator as DragIcon, Settings as SettingsIcon, Edit as EditIcon } from '@mui/icons-material';
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
import { useAuth } from '../contexts/AuthContext';
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

/** One row per (phase + activity) with all assignments grouped */
type ActivityGroupRow = {
  phaseId: string;
  phaseName: string;
  activityId: string;
  activityName: string;
  assignments: FlatRow[];
  minSortOrder: number;
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
  return rows;
}

function groupRowsByActivity(flatRows: FlatRow[]): ActivityGroupRow[] {
  const byKey = new Map<string, FlatRow[]>();
  for (const r of flatRows.filter((row) => row.assignmentId)) {
    const key = `${r.phaseId}:${r.activityId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  return Array.from(byKey.entries())
    .map(([_, assignments]) => {
      const first = assignments[0];
      const minSortOrder = Math.min(...assignments.map((a) => a.sortOrder));
      return {
        phaseId: first.phaseId,
        phaseName: first.phaseName,
        activityId: first.activityId,
        activityName: first.activityName,
        assignments: assignments.sort((a, b) => a.sortOrder - b.sortOrder),
        minSortOrder,
      };
    })
    .sort((a, b) => a.minSortOrder - b.minSortOrder);
}

function GroupEditRow({
  assignment,
  consultants: _consultants,
  onUpdateHours,
  onDelete,
}: {
  assignment: FlatRow;
  consultants: { id: string; name: string; cost_per_hour?: number }[];
  onUpdateHours: (id: string, hours: number) => void;
  onDelete: (id: string) => void;
}) {
  const [hours, setHours] = useState(String(assignment.hours));
  const handleBlur = () => {
    const n = Number(hours);
    if (!Number.isNaN(n) && n >= 0 && assignment.assignmentId) onUpdateHours(assignment.assignmentId, n);
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
      <Typography variant="body2" sx={{ minWidth: 140 }}>{assignment.consultantName}</Typography>
      <TextField
        type="number"
        size="small"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        onBlur={handleBlur}
        inputProps={{ min: 0, step: 0.5 }}
        sx={{ width: 100 }}
      />
      <IconButton size="small" onClick={() => assignment.assignmentId && onDelete(assignment.assignmentId)} aria-label={`Remove ${assignment.consultantName}`}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

function SortableActivityGroupRow({
  id,
  group,
  totalHours,
  totalCost,
  totalRevenue,
  isFirstInPhase,
  isEditingHours,
  editingHours,
  setEditingHours,
  onUpdateHours,
  onEditActivity,
  onDuplicate,
  onDeleteAssignment,
  consultants: _consultants,
  showFinancials = true,
  nonBillable = false,
}: {
  id: string;
  group: ActivityGroupRow;
  totalHours: number;
  totalCost: number;
  totalRevenue: number;
  isFirstInPhase: boolean;
  isEditingHours: boolean;
  editingHours: { id: string; value: string } | null;
  setEditingHours: (v: { id: string; value: string } | null) => void;
  onUpdateHours: (id: string, hours: number) => void;
  onEditActivity: (group: ActivityGroupRow) => void;
  onDuplicate: (group: ActivityGroupRow) => void;
  onDeleteAssignment: (id: string) => void;
  consultants: { id: string; name: string; cost_per_hour?: number; charge_out_rate?: number }[];
  showFinancials?: boolean;
  nonBillable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const firstAssignment = group.assignments[0];

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      sx={{ bgcolor: isDragging ? 'action.hover' : undefined, '& .MuiTableCell-root': { verticalAlign: 'middle' } }}
    >
      <TableCell sx={{ width: 40, p: 0.5, cursor: isDragging ? 'grabbing' : 'grab' }} {...listeners} {...attributes}>
        <DragIcon fontSize="small" color="action" />
      </TableCell>
      <TableCell sx={isFirstInPhase ? { fontWeight: 700 } : undefined}>{group.phaseName}</TableCell>
      <TableCell>{group.activityName}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {group.assignments.map((a) => {
            return (
              <Box
                key={a.assignmentId}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  px: 0.75,
                  py: 0.25,
                }}
              >
                <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: a.consultantColor ?? 'primary.main' }}>
                  {getInitials(a.consultantName)}
                </Avatar>
                <Typography variant="body2" component="span">
                  {a.consultantName}
                </Typography>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (a.assignmentId) onDeleteAssignment(a.assignmentId);
                  }}
                  sx={{ p: 0.25 }}
                  aria-label={`Remove ${a.consultantName}`}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            );
          })}
        </Box>
      </TableCell>
      <TableCell align="center">
        {group.assignments.length === 1 && isEditingHours && editingHours?.id === firstAssignment?.assignmentId ? (
          <TextField
            type="number"
            size="small"
            value={editingHours.value}
            inputProps={{ min: 0, step: 0.5 }}
            sx={{ width: 80 }}
            autoFocus
            onBlur={() => {
              const n = Number(editingHours.value);
              if (!Number.isNaN(n) && n >= 0 && firstAssignment?.assignmentId) onUpdateHours(firstAssignment.assignmentId, n);
              setEditingHours(null);
            }}
            onChange={(e) => setEditingHours({ id: firstAssignment!.assignmentId!, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(editingHours.value);
                if (!Number.isNaN(n) && n >= 0 && firstAssignment?.assignmentId) onUpdateHours(firstAssignment.assignmentId, n);
                setEditingHours(null);
              }
            }}
          />
        ) : (
          <Box
            component="span"
            onClick={() =>
              group.assignments.length === 1 && firstAssignment?.assignmentId
                ? setEditingHours({ id: firstAssignment.assignmentId, value: String(firstAssignment.hours) })
                : onEditActivity(group)
            }
            sx={{
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {totalHours}
          </Box>
        )}
      </TableCell>
      {showFinancials && (
        <>
          {!nonBillable && (
            <TableCell align="right">
              ${roundCurrency(totalRevenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </TableCell>
          )}
          <TableCell align="right">
            ${roundCurrency(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </TableCell>
        </>
      )}
      <TableCell>
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
          <IconButton size="small" onClick={() => onEditActivity(group)} title="Edit activity" sx={{ p: 0.75 }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDuplicate(group)} title="Duplicate row" sx={{ p: 0.75 }}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Box>
      </TableCell>
    </TableRow>
  );
}

export function ProjectDetailPage() {
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const [projectNameEdit, setProjectNameEdit] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<{
    phaseId: string;
    phaseNameNew: string;
    activityId: string;
    activityNameNew: string;
    consultantIds: string[];
    hours: string;
  }>({
    phaseId: '',
    phaseNameNew: '',
    activityId: '',
    activityNameNew: '',
    consultantIds: [],
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
  const [activityGroupToEdit, setActivityGroupToEdit] = useState<ActivityGroupRow | null>(null);
  const [addRowError, setAddRowError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [rateOverrideInputs, setRateOverrideInputs] = useState<Record<string, string>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [detailTab, setDetailTab] = useState(0);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] = useState(false);

  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (!tabParam) return;
    if (tabParam === 'project-report' && isAdmin) setDetailTab(2);
    else if (tabParam === 'time-report' && isAdmin) setDetailTab(3);
  }, [tabParam, isAdmin]);

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

  const activeConsultants = consultants.filter((c) => !c.inactive);

  const editModalConsultantOptions = useMemo(() => {
    if (!activityToEdit?.consultantId) return activeConsultants;
    const current = consultants.find((c) => c.id === activityToEdit.consultantId);
    if (current && current.inactive) {
      return [current, ...activeConsultants.filter((c) => c.id !== current.id)];
    }
    return activeConsultants;
  }, [activeConsultants, consultants, activityToEdit?.consultantId]);

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
    mutationFn: async ({
      id,
      name,
      status,
      nonBillable,
      clientId: cid,
    }: {
      id: string;
      name?: string;
      status?: 'proposal' | 'active';
      nonBillable?: boolean;
      clientId?: string;
    }) => {
      const payload: { name?: string; status?: string; non_billable?: boolean } = {};
      if (name !== undefined) payload.name = name;
      if (status !== undefined) payload.status = status;
      if (nonBillable !== undefined) payload.non_billable = nonBillable;
      if (Object.keys(payload).length === 0) return;
      if (name !== undefined && cid) {
        const nameTrim = name.trim();
        const { data: existing } = await supabase.from('projects').select('id, name').eq('client_id', cid);
        if ((existing ?? []).some((p) => p.id !== id && p.name.trim().toLowerCase() === nameTrim.toLowerCase())) {
          throw new Error('This client already has a project with this name.');
        }
      }
      const { error } = await supabase.from('projects').update(payload).eq('id', id);
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
      setNewRow((r) => ({ ...r, phaseId: '', phaseNameNew: '', activityId: '', activityNameNew: '', consultantIds: [], hours: '' }));
    },
  });

  const createAssignmentsBatchMutation = useMutation({
    mutationFn: async ({
      activity_id,
      consultant_ids,
      hours,
      sort_order_start,
    }: {
      activity_id: string;
      consultant_ids: string[];
      hours: number;
      sort_order_start: number;
    }) => {
      if (consultant_ids.length === 0) return [];
      const inserts = consultant_ids.map((consultant_id, i) => ({
        activity_id,
        consultant_id,
        hours,
        sort_order: sort_order_start + i,
      }));
      const { data, error } = await supabase.from('activity_assignments').insert(inserts).select();
      if (error) throw error;
      return (data ?? []) as ActivityAssignment[];
    },
    onSuccess: (_data, _variables) => {
      if (!projectId) return;
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['project-consultant-rates', projectId] });
      setNewRow((r) => ({ ...r, phaseId: '', phaseNameNew: '', activityId: '', activityNameNew: '', consultantIds: [], hours: '' }));
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
    onSuccess: () => {
      setDuplicateError(null);
      invalidate();
    },
    onError: (err: Error) => {
      const msg = err?.message ?? String(err);
      if ((msg.includes('null value') && msg.includes('consultant_id')) || msg.includes('violates not-null')) {
        setDuplicateError('Duplicate failed: database needs the migration that allows blank consultant. Run migration 003_activity_assignments_optional_consultant.sql in Supabase.');
      } else if (msg.includes('column') && msg.includes('sort_order')) {
        setDuplicateError('Duplicate failed: database needs the migration that adds sort_order. Run migration 002_activity_assignments_sort_order.sql in Supabase.');
      } else {
        setDuplicateError(msg || 'Duplicate failed.');
      }
    },
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
  const groupRows = useMemo(() => groupRowsByActivity(rows), [rows]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groupRows.findIndex((g) => g.activityId === active.id);
    const newIndex = groupRows.findIndex((g) => g.activityId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedGroups = arrayMove(groupRows, oldIndex, newIndex);
    const flatOrder = reorderedGroups.flatMap((g) => g.assignments);
    const updates = flatOrder.map((r, i) => ({ id: r.assignmentId!, sort_order: i }));
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
        <Typography color="error" sx={{ mb: 2 }}>Failed to load project. {(error as Error)?.message ?? 'Please try again.'}</Typography>
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

  const handleDuplicateGroup = (group: ActivityGroupRow) => {
    setDuplicateError(null);
    const maxOrder = Math.max(...rows.map((r) => r.sortOrder), -1);
    group.assignments.forEach((a, i) => {
      duplicateAssignmentMutation.mutate({
        activity_id: group.activityId,
        hours: a.hours,
        insert_after_sort_order: maxOrder + 1 + i,
      });
    });
  };

  const handleCopyTableToWord = async () => {
    const headers = ['Phase', 'Activity', 'Consultants', 'Hours', 'Cost'];
    const headerRow = '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const dataRows = groupRows
      .map((group) => {
        const consultantNames = group.assignments.map((a) => a.consultantName).join(', ');
        const totalHours = group.assignments.reduce((s, a) => s + a.hours, 0);
        const totalCost = group.assignments.reduce((s, a) => {
          const c = consultants.find((x) => x.id === a.consultantId);
          return s + (c ? a.hours * (Number(c.cost_per_hour) || 0) : 0);
        }, 0);
        return `<tr><td>${group.phaseName}</td><td>${group.activityName}</td><td>${consultantNames}</td><td>${totalHours}</td><td>$${roundCurrency(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`;
      })
      .join('');
    const costTotal = groupRows.reduce((sum, group) => {
      return sum + group.assignments.reduce((s, a) => {
        const c = consultants.find((x) => x.id === a.consultantId);
        return s + (c ? a.hours * (Number(c.cost_per_hour) || 0) : 0);
      }, 0);
    }, 0);
    const hoursTotal = groupRows.reduce((sum, group) => sum + group.assignments.reduce((s, a) => s + a.hours, 0), 0);
    const totalRow = `<tr><td colspan="3"><strong>Total - Excludes GST and project related expenses</strong></td><td><strong>${hoursTotal}</strong></td><td><strong>$${roundCurrency(costTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td></tr>`;
    const html = `<table border="1" cellpadding="4" cellspacing="0"><thead>${headerRow}</thead><tbody>${dataRows}${totalRow}</tbody></table>`;
    const plain = [
      headers.join('\t'),
      ...groupRows.map((group) => {
        const consultantNames = group.assignments.map((a) => a.consultantName).join(', ');
        const totalHours = group.assignments.reduce((s, a) => s + a.hours, 0);
        const totalCost = group.assignments.reduce((s, a) => {
          const c = consultants.find((x) => x.id === a.consultantId);
          return s + (c ? a.hours * (Number(c.cost_per_hour) || 0) : 0);
        }, 0);
        return [group.phaseName, group.activityName, consultantNames, totalHours, `$${roundCurrency(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}`].join('\t');
      }),
      ['Total - Excludes GST and project related expenses', '', '', hoursTotal, `$${roundCurrency(costTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`].join('\t'),
    ].join('\n');
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
    ]);
  };

  const handleSaveProjectName = () => {
    const name = (projectNameEdit ?? '').trim();
    if (name && name !== projectData.name) updateProjectMutation.mutate({ id: projectId!, name, clientId: clientId! });
    setProjectNameEdit(null);
  };

  const projectStatus = (projectData as Project).status ?? 'proposal';
  const nonBillable = Boolean((projectData as Project).non_billable);

  const handleAddRow = async () => {
    setAddRowError(null);
    const hours = Number(newRow.hours);
    const hoursValid = !Number.isNaN(hours) && hours >= 0;

    if (nonBillable) {
      if (newRow.consultantIds.length === 0) {
        setAddRowError('Select at least one consultant.');
        return;
      }
    } else {
      if (newRow.consultantIds.length === 0) {
        setAddRowError('Select a consultant and enter valid hours.');
        return;
      }
      if (!hoursValid) {
        setAddRowError('Select a consultant and enter valid hours.');
        return;
      }
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

    if (nonBillable) {
      try {
        await createAssignmentsBatchMutation.mutateAsync({
          activity_id: activityId,
          consultant_ids: newRow.consultantIds,
          hours: 0,
          sort_order_start: nextSortOrder,
        });
      } catch (e: unknown) {
        const err = e as { message?: string; code?: string };
        const msg = err?.message ?? String(e);
        if (msg.includes('unique') || msg.includes('duplicate') || err?.code === '23505') {
          setAddRowError('One or more consultants are already assigned to this activity.');
        } else {
          setAddRowError(msg || 'Failed to save.');
        }
      }
      return;
    }

    try {
      await createAssignmentMutation.mutateAsync({
        activity_id: activityId,
        consultant_id: newRow.consultantIds[0],
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
    (nonBillable ? newRow.consultantIds.length > 0 : newRow.consultantIds.length === 1 && newRow.hours !== '' && !Number.isNaN(Number(newRow.hours)) && Number(newRow.hours) >= 0);

  const activitiesForPhase = (phaseId: string): ActivityWithAssignmentsDisplay[] =>
    phases.find((p) => p.id === phaseId)?.activities ?? [];

  return (
    <Box sx={{ maxWidth: 1600, width: '100%' }}>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
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
            <Chip size="small" label={projectStatus === 'active' ? 'Active' : 'Proposal'} color={projectStatus === 'active' ? 'success' : 'default'} sx={{ alignSelf: 'center' }} />
            {nonBillable && (
              <Chip size="small" label="Non-billable" sx={{ alignSelf: 'center' }} variant="outlined" />
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
        {updateProjectMutation.isError && (
          <Typography variant="body2" color="error.main" sx={{ mt: 0.5 }}>
            {(updateProjectMutation.error as Error)?.message}
          </Typography>
        )}
      </Box>

      <Menu
        anchorEl={settingsAnchor}
        open={!!settingsAnchor}
        onClose={() => setSettingsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {isAdmin && (
          <>
            <MenuItem
              onClick={() => {
                setSettingsAnchor(null);
                if (projectStatus !== 'proposal') updateProjectMutation.mutate({ id: projectId!, status: 'proposal' });
              }}
              dense
            >
              <ListItemIcon>
                <Checkbox checked={projectStatus === 'proposal'} disableRipple size="small" />
              </ListItemIcon>
              <ListItemText primary="Status: Proposal" />
            </MenuItem>
            <MenuItem
              onClick={() => {
                setSettingsAnchor(null);
                if (projectStatus !== 'active') updateProjectMutation.mutate({ id: projectId!, status: 'active' });
              }}
              dense
            >
              <ListItemIcon>
                <Checkbox checked={projectStatus === 'active'} disableRipple size="small" />
              </ListItemIcon>
              <ListItemText primary="Status: Active" />
            </MenuItem>
            <MenuItem
              onClick={() => {
                setSettingsAnchor(null);
                updateProjectMutation.mutate({ id: projectId!, nonBillable: !nonBillable });
              }}
              dense
            >
              <ListItemIcon>
                <Checkbox checked={nonBillable} disableRipple size="small" />
              </ListItemIcon>
              <ListItemText primary="Non-billable" secondary="Track hours and cost only" />
            </MenuItem>
          </>
        )}
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
        <DialogContent sx={{ pt: 4 }}>
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
        <DialogContent sx={{ pt: 4, '& .MuiFormControl-root': { marginBottom: 4 } }}>
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
            options={editModalConsultantOptions}
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

      <Dialog
        open={!!activityGroupToEdit}
        onClose={() => !updateAssignmentMutation.isPending && setActivityGroupToEdit(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit activity: {activityGroupToEdit?.activityName}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {activityGroupToEdit?.assignments.map((a) => (
            <GroupEditRow
              key={a.assignmentId}
              assignment={a}
              consultants={consultants}
              onUpdateHours={(id, hours) => updateAssignmentMutation.mutate({ id, hours })}
              onDelete={(id) => {
                deleteAssignmentMutation.mutate(id);
                setActivityGroupToEdit((prev) => {
                  if (!prev) return null;
                  const next = prev.assignments.filter((x) => x.assignmentId !== id);
                  return next.length === 0 ? null : { ...prev, assignments: next };
                });
              }}
            />
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setActivityGroupToEdit(null)} disabled={updateAssignmentMutation.isPending}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 2, mb: 3, maxWidth: 1600 }}>
        {isAdmin && (
          <>
            <Card>
              <CardContent>
                <Typography variant="body2" color="text.secondary">{projectStatus === 'proposal' ? 'Estimated cost' : 'Cost'}</Typography>
                <Typography variant="h6">${roundCurrency(summary.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Typography>
              </CardContent>
            </Card>
            {!nonBillable && (
              <>
                <Card>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">{projectStatus === 'proposal' ? 'Estimated revenue' : 'Revenue'}</Typography>
                    <Typography variant="h6">${roundCurrency(summary.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Typography>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">{projectStatus === 'proposal' ? 'Estimated profit' : 'Profit'}</Typography>
                    <Typography variant="h6" color={summary.profit >= 0 ? 'success.main' : 'error.main'}>
                      ${roundCurrency(summary.profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">{projectStatus === 'proposal' ? 'Estimated margin' : 'Margin'}</Typography>
                    <Typography variant="h6" color={summary.marginPercent >= 0 ? 'success.main' : 'error.main'}>
                      {summary.marginPercent.toFixed(1)}%
                    </Typography>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
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
          {isAdmin && !nonBillable && (
            <Tab label="Rate Overrides" id="detail-tab-1" aria-controls="detail-tabpanel-1" />
          )}
        </Tabs>
        <CardContent sx={{ pt: 2 }}>
          <Box role="tabpanel" id="detail-tabpanel-0" aria-labelledby="detail-tab-0" hidden={detailTab !== 0}>
            {detailTab === 0 && (
              <>
                {isAdmin && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                    <Tooltip title="Copy to clipboard to paste into proposal">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<CopyIcon />}
                        onClick={handleCopyTableToWord}
                      >
                        Copy
                      </Button>
                    </Tooltip>
                  </Box>
                )}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
            <TableHead>
              <TableRow sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
                <TableCell sx={{ width: 40 }} />
                <TableCell sx={{ fontWeight: 700 }}>Phase</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Activity</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Consultant</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>Hours</TableCell>
                {isAdmin && !nonBillable && (
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Revenue</TableCell>
                )}
                {isAdmin && (
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
                )}
                <TableCell width={100} />
              </TableRow>
            </TableHead>
            <TableBody>
              <SortableContext
                items={groupRows.map((g) => g.activityId)}
                strategy={verticalListSortingStrategy}
              >
              {groupRows.map((group, dataIndex) => {
                const totalHours = group.assignments.reduce((s, a) => s + a.hours, 0);
                const totalCost = group.assignments.reduce((s, a) => {
                  const c = consultants.find((x) => x.id === a.consultantId);
                  return s + (c ? a.hours * (Number(c.cost_per_hour) || 0) : 0);
                }, 0);
                const totalRevenue = nonBillable
                  ? 0
                  : group.assignments.reduce((s, a) => {
                      const c = consultants.find((x) => x.id === a.consultantId);
                      return s + (c ? a.hours * getChargeRate(c) : 0);
                    }, 0);
                const isFirstInPhase = dataIndex === 0 || groupRows[dataIndex - 1].phaseId !== group.phaseId;
                const isEditingHours = !!group.assignments.find((a) => a.assignmentId && editingHours?.id === a.assignmentId);
                return (
                  <SortableActivityGroupRow
                    key={group.activityId}
                    id={group.activityId}
                    group={group}
                    totalHours={totalHours}
                    totalCost={totalCost}
                    totalRevenue={totalRevenue}
                    isFirstInPhase={isFirstInPhase}
                    isEditingHours={isEditingHours}
                    editingHours={editingHours}
                    setEditingHours={setEditingHours}
                    onUpdateHours={(id, hours) => updateAssignmentMutation.mutate({ id, hours })}
                    onEditActivity={(grp) => setActivityGroupToEdit(grp)}
                    onDuplicate={handleDuplicateGroup}
                    onDeleteAssignment={(id) => deleteAssignmentMutation.mutate(id)}
                    consultants={consultants}
                    showFinancials={isAdmin}
                    nonBillable={nonBillable}
                  />
                );
              })}
              </SortableContext>
              <TableRow sx={{ bgcolor: 'grey.100', fontWeight: 700, '& .MuiTableCell-root': { verticalAlign: 'middle', py: 1.5 } }}>
                <TableCell sx={{ py: 1.5 }} />
                <TableCell colSpan={3} sx={{ fontWeight: 700, py: 1.5 }}>Total - Excludes GST and project related expenses</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, py: 1.5 }}>
                  {groupRows.reduce((s, g) => s + g.assignments.reduce((sum, a) => sum + a.hours, 0), 0).toFixed(1)}
                </TableCell>
                {isAdmin && !nonBillable && (
                  <TableCell align="right" sx={{ fontWeight: 700, py: 1.5 }}>
                    ${roundCurrency(summary.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell align="right" sx={{ fontWeight: 700, py: 1.5 }}>
                    ${roundCurrency(summary.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </TableCell>
                )}
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
              {duplicateError && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 1, verticalAlign: 'middle' }}>
                    <Alert severity="error" onClose={() => setDuplicateError(null)}>
                      {duplicateError}
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
                  {nonBillable ? (
                    <Autocomplete
                      multiple
                      disableCloseOnSelect
                      size="small"
                      options={activeConsultants}
                      getOptionLabel={(c) => c.name}
                      value={activeConsultants.filter((c) => newRow.consultantIds.includes(c.id))}
                      onChange={(_, value) => setNewRow((r) => ({ ...r, consultantIds: value.map((c) => c.id) }))}
                      renderOption={(props, option, { selected }) => (
                        <li {...props} key={option.id}>
                          <Checkbox size="small" sx={{ mr: 1 }} checked={selected} />
                          <ListItemText primary={option.name} />
                        </li>
                      )}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Consultants (select multiple)" size="small" sx={{ minWidth: 240 }} />
                      )}
                    />
                  ) : (
                    <Autocomplete
                      size="small"
                      options={activeConsultants}
                      getOptionLabel={(c) => c.name}
                      value={activeConsultants.find((c) => c.id === newRow.consultantIds[0]) ?? null}
                      onChange={(_, value) => setNewRow((r) => ({ ...r, consultantIds: value ? [value.id] : [] }))}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Consultant (type to search)" size="small" sx={{ minWidth: 200 }} />
                      )}
                    />
                  )}
                  {!nonBillable && (
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
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={() => handleAddRow()}
                    disabled={!canSave || createAssignmentMutation.isPending || createAssignmentsBatchMutation.isPending || createPhaseMutation.isPending || createActivityMutation.isPending}
                  >
                    Save
                  </Button>
                </Box>
              </>
            )}
          </Box>

          {isAdmin && !nonBillable && (
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
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
