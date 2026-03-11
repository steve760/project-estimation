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
  Divider,
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
import { computeFinancialSummary, formatCurrency, getDisplayRateAndRowBudget, roundCurrency } from '../lib/calculations';

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

/** One row per (phase + activity) with all assignments grouped - used for summary only */
type ActivityGroupRow = {
  phaseId: string;
  phaseName: string;
  activityId: string;
  activityName: string;
  assignments: FlatRow[];
  minSortOrder: number;
};

/** One row per task (phase + activity). Consultants are on the project (Team tab), not per task. */
type TaskRow = {
  phaseId: string;
  phaseName: string;
  activityId: string;
  activityName: string;
  phaseSortOrder: number;
  activitySortOrder: number;
  estimatedHours: number;
  defaultRate?: number | null;
};

function buildTaskRows(project: { phases?: PhaseWithActivitiesDisplay[]; non_billable?: boolean }): TaskRow[] {
  const nonBillable = Boolean((project as { non_billable?: boolean }).non_billable);
  const rows: TaskRow[] = [];
  for (const phase of project.phases ?? []) {
    const activities = (phase.activities ?? []) as (Activity & { sort_order?: number; estimated_hours?: number; default_rate?: number | null })[];
    for (const activity of activities) {
      rows.push({
        phaseId: phase.id,
        phaseName: phase.name,
        activityId: activity.id,
        activityName: activity.name,
        phaseSortOrder: phase.sort_order ?? 0,
        activitySortOrder: activity.sort_order ?? 0,
        estimatedHours: nonBillable ? 0 : (activity.estimated_hours ?? 0),
        defaultRate: activity.default_rate ?? null,
      });
    }
  }
  rows.sort((a, b) => a.phaseSortOrder - b.phaseSortOrder || a.activitySortOrder - b.activitySortOrder);
  return rows;
}

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

function _GroupEditRow({
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

function _SortableActivityGroupRow({
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
      <TableCell sx={isFirstInPhase ? { fontWeight: 700 } : undefined}>{isFirstInPhase ? group.phaseName : ''}</TableCell>
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
              {formatCurrency(roundCurrency(totalRevenue))}
            </TableCell>
          )}
          <TableCell align="right">
            {formatCurrency(roundCurrency(totalCost))}
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

void _GroupEditRow;
void _SortableActivityGroupRow;

function SortableTaskRow({
  id,
  task,
  isFirstInPhase,
  showHours,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  id: string;
  task: TaskRow;
  isFirstInPhase: boolean;
  showHours: boolean;
  onEdit: (task: TaskRow) => void;
  onDuplicate: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      sx={{ bgcolor: isDragging ? 'action.hover' : undefined, '& .MuiTableCell-root': { verticalAlign: 'middle' } }}
    >
      <TableCell sx={{ width: 90, p: 0.5, cursor: isDragging ? 'grabbing' : 'grab' }} {...listeners} {...attributes}>
        <DragIcon fontSize="small" color="action" />
      </TableCell>
      <TableCell sx={{ width: 277, ...(isFirstInPhase ? { fontWeight: 700 } : {}) }}>{isFirstInPhase ? task.phaseName : ''}</TableCell>
      <TableCell sx={{ width: 403 }}>{task.activityName}</TableCell>
      {showHours && (
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 162, pl: 1 }}>
          {task.estimatedHours > 0 ? task.estimatedHours : '—'}
        </TableCell>
      )}
      {showHours && (() => {
        const { displayRate, rowBudget } = getDisplayRateAndRowBudget(task.estimatedHours, task.defaultRate);
        return (
          <>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 90 }}>
              {displayRate > 0 ? formatCurrency(displayRate) : '—'}
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 100 }}>
              {rowBudget > 0 ? formatCurrency(rowBudget) : '—'}
            </TableCell>
          </>
        );
      })()}
      <TableCell sx={{ width: 221 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" onClick={() => onEdit(task)} title="Edit activity" sx={{ p: 0.75 }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDuplicate(task)} title="Duplicate" sx={{ p: 0.75 }}>
            <CopyIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(task)} title="Delete activity" sx={{ p: 0.75 }}>
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
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const [projectNameEdit, setProjectNameEdit] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<{
    phaseId: string;
    phaseNameNew: string;
    activityId: string;
    activityNameNew: string;
    hours: string;
    defaultRate: string;
  }>({
    phaseId: '',
    phaseNameNew: '',
    activityId: '',
    activityNameNew: '',
    hours: '',
    defaultRate: '',
  });
  const [taskToEdit, setTaskToEdit] = useState<{
    activityId: string;
    activityName: string;
    phaseId: string;
    phaseName: string;
    estimatedHours: number;
    defaultRate?: number | null;
  } | null>(null);
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
    queryClient.invalidateQueries({ queryKey: ['project-consultants', projectId] });
  }, [queryClient, projectId, clientId]);

  const { data: projectTeam = [] } = useQuery({
    queryKey: ['project-consultants', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_consultants')
        .select('project_id, consultant_id, consultant:consultants(id, name, cost_per_hour, charge_out_rate, inactive)')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as { project_id: string; consultant_id: string; consultant: Consultant | Consultant[] }[];
    },
    enabled: !!projectId,
  });

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

  const [, setEditingHours] = useState<{ id: string; value: string } | null>(null);

  const createPhaseMutation = useMutation({
    mutationFn: async ({ project_id, name }: { project_id: string; name: string }) => {
      const { count } = await supabase.from('phases').select('*', { count: 'exact', head: true }).eq('project_id', project_id);
      const { data, error } = await supabase.from('phases').insert({ project_id, name, sort_order: count ?? 0 }).select('id').single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => invalidate(),
  });

  const updatePhaseMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('phases').update({ name: name.trim() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const createActivityMutation = useMutation({
    mutationFn: async ({
      phase_id,
      name,
      estimated_hours,
      default_rate,
    }: {
      phase_id: string;
      name: string;
      estimated_hours?: number;
      default_rate?: number | null;
    }) => {
      const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('phase_id', phase_id);
      const hours = estimated_hours != null && !Number.isNaN(estimated_hours) && estimated_hours >= 0 ? estimated_hours : 0;
      const payload: { phase_id: string; name: string; sort_order: number; estimated_hours: number; default_rate?: number | null } = {
        phase_id,
        name,
        sort_order: count ?? 0,
        estimated_hours: hours,
      };
      if (default_rate !== undefined && default_rate !== null && !Number.isNaN(default_rate) && default_rate >= 0) {
        payload.default_rate = default_rate;
      }
      const { data, error } = await supabase.from('activities').insert(payload).select('id').single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => invalidate(),
  });

  const updateActivityMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      phase_id,
      estimated_hours,
      default_rate,
    }: {
      id: string;
      name: string;
      phase_id?: string;
      estimated_hours?: number;
      default_rate?: number | null;
    }) => {
      const payload: { name: string; phase_id?: string; estimated_hours?: number; default_rate?: number | null } = { name };
      if (phase_id !== undefined) payload.phase_id = phase_id;
      if (estimated_hours !== undefined) payload.estimated_hours = Math.max(0, Number(estimated_hours) || 0);
      if (default_rate !== undefined) payload.default_rate = default_rate == null || Number.isNaN(Number(default_rate)) || Number(default_rate) < 0 ? null : Number(default_rate);
      const { error } = await supabase.from('activities').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('activities').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const reorderActivitiesMutation = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number; phase_id?: string }[]) => {
      for (const u of updates) {
        const payload: { sort_order: number; phase_id?: string } = { sort_order: u.sort_order };
        if (u.phase_id !== undefined) payload.phase_id = u.phase_id;
        const { error } = await supabase.from('activities').update(payload).eq('id', u.id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const _createAssignmentMutation = useMutation({
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

  const _createAssignmentsBatchMutation = useMutation({
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

  const _updateAssignmentMutation = useMutation({
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

  const _deleteAssignmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('activity_assignments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const _duplicateAssignmentMutation = useMutation({
    mutationFn: async ({
      activity_id,
      consultant_id,
      hours,
      insert_after_sort_order,
    }: {
      activity_id: string;
      consultant_id: string | null;
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
        consultant_id: consultant_id || null,
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

  const _reorderAssignmentsMutation = useMutation({
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

  const _addConsultantToProjectMutation = useMutation({
    mutationFn: async ({ project_id, consultant_id }: { project_id: string; consultant_id: string }) => {
      const { error } = await supabase.from('project_consultants').insert({ project_id, consultant_id });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const addConsultantsToProjectMutation = useMutation({
    mutationFn: async ({ project_id, consultant_ids }: { project_id: string; consultant_ids: string[] }) => {
      if (consultant_ids.length === 0) return;
      const rows = consultant_ids.map((consultant_id) => ({ project_id, consultant_id }));
      const { error } = await supabase.from('project_consultants').upsert(rows, { onConflict: 'project_id,consultant_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const removeConsultantFromProjectMutation = useMutation({
    mutationFn: async ({ project_id, consultant_id }: { project_id: string; consultant_id: string }) => {
      const { error } = await supabase
        .from('project_consultants')
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
  const _groupRows = useMemo(() => groupRowsByActivity(rows), [rows]);
  const taskRows = useMemo(() => (project ? buildTaskRows(project) : []), [project]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = taskRows.findIndex((t) => t.activityId === active.id);
    const newIndex = taskRows.findIndex((t) => t.activityId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(taskRows, oldIndex, newIndex);
    const targetPhaseId = taskRows[newIndex].phaseId;
    const effectivePhase = (idx: number) => (idx === newIndex ? targetPhaseId : reordered[idx].phaseId);
    const byPhase = new Map<string, { activityId: string; sort_order: number; phase_id?: string }[]>();
    reordered.forEach((t, i) => {
      const phaseId = effectivePhase(i);
      if (!byPhase.has(phaseId)) byPhase.set(phaseId, []);
      const updates = byPhase.get(phaseId)!;
      const entry: { activityId: string; sort_order: number; phase_id?: string } = { activityId: t.activityId, sort_order: updates.length };
      if (t.phaseId !== phaseId) entry.phase_id = phaseId;
      updates.push(entry);
    });
    const updates = Array.from(byPhase.values())
      .flat()
      .map((u) => ({ id: u.activityId, sort_order: u.sort_order, ...(u.phase_id != null && { phase_id: u.phase_id }) }));
    reorderActivitiesMutation.mutate(updates);
  };

  const projectData = data?.project ?? null;
  const phases = projectData?.phases ?? [];
  const nonBillable = Boolean(projectData && (projectData as Project).non_billable);

  const allAssignments = useMemo(() => {
    const out: { hours: number; consultant: Consultant }[] = [];
    for (const phase of phases) {
      for (const activity of phase.activities ?? []) {
        for (const a of activity.assignments ?? []) {
          if (a.consultant) out.push({ hours: a.hours, consultant: a.consultant });
        }
      }
    }
    return out;
  }, [phases]);

  const totalEstimatedHours = useMemo(
    () => taskRows.reduce((s, t) => s + t.estimatedHours, 0),
    [taskRows]
  );

  const teamConsultants = useMemo(
    () =>
      projectTeam.flatMap((r) => {
        const c = r.consultant;
        return Array.isArray(c) ? c : c ? [c] : [];
      }).filter((c): c is Consultant => !!c),
    [projectTeam]
  );

  const assignmentsForSummary = useMemo(() => {
    if (allAssignments.length > 0) return allAssignments;
    if (totalEstimatedHours > 0 && teamConsultants.length > 0) {
      const hoursPerConsultant = totalEstimatedHours / teamConsultants.length;
      return teamConsultants.map((c) => ({ hours: hoursPerConsultant, consultant: c }));
    }
    return [];
  }, [totalEstimatedHours, teamConsultants, allAssignments]);

  const chargeOutOverridesMap = useMemo(
    () => new Map<string, number>(rateOverrides.map((r) => [r.consultant_id, r.charge_out_rate])),
    [rateOverrides]
  );

  const revenueFromTaskRates = useMemo(() => {
    let sum = 0;
    for (const phase of phases) {
      for (const activity of phase.activities ?? []) {
        const act = activity as Activity & { estimated_hours?: number; default_rate?: number | null };
        const hours = Number(act.estimated_hours) || 0;
        const { rowBudget } = getDisplayRateAndRowBudget(hours, act.default_rate);
        sum += rowBudget;
      }
    }
    return sum;
  }, [phases]);

  const summary = useMemo(() => {
    const costSummary = computeFinancialSummary(assignmentsForSummary, chargeOutOverridesMap);
    const revenue = nonBillable ? 0 : (revenueFromTaskRates > 0 ? revenueFromTaskRates : costSummary.revenue);
    const cost = costSummary.cost;
    const profit = revenue - cost;
    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { cost, revenue, profit, marginPercent };
  }, [assignmentsForSummary, chargeOutOverridesMap, nonBillable, revenueFromTaskRates]);
  const _getChargeRate = useCallback(
    (consultant: Consultant) => chargeOutOverridesMap.get(consultant.id) ?? consultant.charge_out_rate,
    [chargeOutOverridesMap]
  );

  const _projectConsultants = useMemo(() => {
    const byId = new Map<string, Consultant>();
    for (const row of projectTeam) {
      const c = row.consultant;
      const consultants = Array.isArray(c) ? c : c ? [c] : [];
      for (const cons of consultants) {
        if (cons && !cons.inactive) byId.set(cons.id, cons);
      }
    }
    for (const a of allAssignments) {
      if (a.consultant && !a.consultant.inactive) byId.set(a.consultant.id, a.consultant);
    }
    return [...byId.values()];
  }, [projectTeam, allAssignments]);

  if (false as boolean) {
    void _createAssignmentMutation;
    void _createAssignmentsBatchMutation;
    void _updateAssignmentMutation;
    void _deleteAssignmentMutation;
    void _duplicateAssignmentMutation;
    void _reorderAssignmentsMutation;
    void _addConsultantToProjectMutation;
    void _groupRows;
    void _getChargeRate;
    void _projectConsultants;
  }

  const consultantsNotOnTeam = useMemo(
    () => activeConsultants.filter((c) => !teamConsultants.some((t) => t.id === c.id)),
    [activeConsultants, teamConsultants]
  );

  const hasRateOverrideChanges = useMemo(() => {
    if (nonBillable || teamConsultants.length === 0) return false;
    return teamConsultants.some((c) => {
      const saved = rateOverrides.find((r) => r.consultant_id === c.id);
      const inputRaw = rateOverrideInputs[c.id] ?? (saved != null ? String(saved.charge_out_rate) : '');
      const inputNum = inputRaw === '' ? null : Number(inputRaw);
      const savedNum = saved?.charge_out_rate ?? null;
      if (inputNum !== null && Number.isNaN(inputNum)) return false;
      return inputNum !== savedNum;
    });
  }, [nonBillable, teamConsultants, rateOverrides, rateOverrideInputs]);

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

  const loadedProject = data.project;

  const handleSaveRateOverrides = async () => {
    setSavingOverrides(true);
    try {
      for (const c of teamConsultants) {
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

  const handleDuplicateGroup = (task: TaskRow) => {
    setDuplicateError(null);
    createActivityMutation.mutate(
      {
        phase_id: task.phaseId,
        name: `${task.activityName} (copy)`,
        estimated_hours: nonBillable ? 0 : task.estimatedHours,
        default_rate: task.defaultRate ?? null,
      },
      {
        onSuccess: () => setDuplicateError(null),
        onError: (err: Error) => setDuplicateError(err?.message ?? 'Duplicate failed.'),
      }
    );
  };

  const handleDeleteTask = (task: TaskRow) => {
    deleteActivityMutation.mutate(task.activityId);
  };

  const handleCopyTableToWord = async () => {
    const headers = ['Phase', 'Activity', 'Hours'];
    const headerRow = '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const dataRows = taskRows
      .map((task) => `<tr><td>${task.phaseName}</td><td>${task.activityName}</td><td>${task.estimatedHours > 0 ? task.estimatedHours : ''}</td></tr>`)
      .join('');
    const html = `<table border="1" cellpadding="4" cellspacing="0"><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
    const plain = [headers.join('\t'), ...taskRows.map((t) => [t.phaseName, t.activityName, t.estimatedHours > 0 ? t.estimatedHours : ''].join('\t'))].join('\n');
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
    ]);
  };

  const handleSaveProjectName = () => {
    const name = (projectNameEdit ?? '').trim();
    if (name && name !== loadedProject.name) updateProjectMutation.mutate({ id: projectId!, name, clientId: clientId! });
    setProjectNameEdit(null);
  };

  const projectStatus = (loadedProject as Project).status ?? 'proposal';

  const handleAddRow = async () => {
    setAddRowError(null);
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

    const phase = phases.find((p) => p.id === phaseId);
    const activitiesInPhase = phase?.activities ?? [];
    let activityId = newRow.activityId;
    const hoursNum = nonBillable ? 0 : (newRow.hours !== '' ? Math.max(0, Number(newRow.hours) || 0) : 0);
      if (!activityId && newRow.activityNameNew.trim()) {
      const existing = activitiesInPhase.find((a: ActivityWithAssignmentsDisplay) => a.name.toLowerCase() === newRow.activityNameNew.trim().toLowerCase());
      if (existing) activityId = existing.id;
      else {
        try {
          const defaultRateNum =
            newRow.defaultRate !== '' && !Number.isNaN(Number(newRow.defaultRate)) && Number(newRow.defaultRate) >= 0
              ? Number(newRow.defaultRate)
              : null;
          const created = await createActivityMutation.mutateAsync({
            phase_id: phaseId,
            name: newRow.activityNameNew.trim(),
            estimated_hours: hoursNum,
            default_rate: defaultRateNum,
          });
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
    if (!nonBillable && activityId && hoursNum > 0) {
      const act = phases.flatMap((p) => p.activities ?? []).find((a: ActivityWithAssignmentsDisplay) => a.id === activityId) as (Activity & { estimated_hours?: number }) | undefined;
      if (act && (act.estimated_hours ?? 0) !== hoursNum) {
        updateActivityMutation.mutate({ id: activityId, name: act.name, estimated_hours: hoursNum });
      }
    }
    setNewRow({ phaseId: '', phaseNameNew: '', activityId: '', activityNameNew: '', hours: '', defaultRate: '' });
  };

  const phaseOptions = phases.map((p) => p.name);
  const selectedPhaseId = newRow.phaseId || (newRow.phaseNameNew && phases.find((p) => p.name.toLowerCase() === newRow.phaseNameNew.trim().toLowerCase())?.id);
  const activityOptions = (phases.find((p) => p.id === selectedPhaseId)?.activities ?? []).map((a: ActivityWithAssignmentsDisplay) => a.name);
  const canSave =
    (newRow.phaseId || newRow.phaseNameNew.trim()) && (newRow.activityId || newRow.activityNameNew.trim());

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
              <Typography variant="h4" fontWeight={600} onClick={() => setProjectNameEdit(loadedProject.name)} sx={{ cursor: 'text' }}>
                {loadedProject.name}
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
        <Box sx={{ bgcolor: 'grey.50' }}>
          <DialogTitle id="delete-project-dialog-title">Delete project?</DialogTitle>
        </Box>
        <Divider />
        <DialogContent sx={{ pt: 4 }}>
          <DialogContentText>
            This will permanently delete the project &quot;{loadedProject.name}&quot; and all its phases, activities and assignments. This cannot be undone.
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
        open={!!taskToEdit}
        onClose={() => !updateActivityMutation.isPending && !deleteActivityMutation.isPending && !updatePhaseMutation.isPending && setTaskToEdit(null)}
        maxWidth="sm"
        fullWidth
      >
        <Box sx={{ bgcolor: 'grey.50' }}>
          <DialogTitle>Edit task</DialogTitle>
        </Box>
        <Divider />
        <DialogContent sx={{ pt: 8, '& .MuiFormControl-root': { marginBottom: 2 } }}>
          <Autocomplete
            size="small"
            freeSolo
            options={phases}
            getOptionLabel={(p) => (typeof p === 'string' ? p : p.name)}
            value={phases.find((p) => p.id === taskToEdit?.phaseId && p.name === taskToEdit?.phaseName) ?? null}
            inputValue={taskToEdit?.phaseName ?? ''}
            onInputChange={(_, v) =>
              setTaskToEdit((a) =>
                a
                  ? {
                      ...a,
                      phaseName: v ?? '',
                      phaseId: phases.find((p) => p.name === (v ?? '').trim())?.id ?? a.phaseId,
                    }
                  : null
              )
            }
            onChange={(_, value) => {
              const phase = value != null && typeof value !== 'string' ? value : null;
              if (phase) setTaskToEdit((a) => (a ? { ...a, phaseId: phase.id, phaseName: phase.name } : null));
            }}
            renderInput={(params) => (
              <TextField {...params} label="Phase" placeholder="Select or type a phase name" />
            )}
          />
          <TextField
            fullWidth
            label="Activity name"
            value={taskToEdit?.activityName ?? ''}
            onChange={(e) => setTaskToEdit((a) => (a ? { ...a, activityName: e.target.value } : null))}
          />
          {!nonBillable && (
            <TextField
              fullWidth
              type="number"
              label="Hours"
              value={taskToEdit?.estimatedHours ?? ''}
              onChange={(e) => setTaskToEdit((a) => (a ? { ...a, estimatedHours: Number(e.target.value) || 0 } : null))}
              inputProps={{ min: 0, step: 0.5 }}
            />
          )}
          {!nonBillable && (
            <TextField
              fullWidth
              type="number"
              label="Default rate ($/hr)"
              placeholder="Budget rate for this task"
              value={taskToEdit?.defaultRate ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setTaskToEdit((a) => (a ? { ...a, defaultRate: v === '' || v === '-' ? null : Number(v) || 0 } : null));
              }}
              inputProps={{ min: 0, step: 0.01 }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button
            color="error"
            onClick={() => {
              if (taskToEdit) {
                deleteActivityMutation.mutate(taskToEdit.activityId, { onSuccess: () => setTaskToEdit(null) });
              }
            }}
            disabled={!taskToEdit || deleteActivityMutation.isPending || updateActivityMutation.isPending || updatePhaseMutation.isPending}
          >
            Delete activity
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={() => setTaskToEdit(null)} disabled={updateActivityMutation.isPending || deleteActivityMutation.isPending || updatePhaseMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (!taskToEdit) return;
                const phaseNameTrim = taskToEdit.phaseName.trim();
                let phaseId = taskToEdit.phaseId;
                const existingByName = phases.find((p) => p.name.trim().toLowerCase() === phaseNameTrim.toLowerCase());
                if (existingByName) {
                  phaseId = existingByName.id;
                  if (existingByName.name !== phaseNameTrim) {
                    await updatePhaseMutation.mutateAsync({ id: existingByName.id, name: phaseNameTrim });
                  }
                } else if (phaseNameTrim) {
                  const created = await createPhaseMutation.mutateAsync({ project_id: projectId!, name: phaseNameTrim });
                  phaseId = created.id;
                }
                updateActivityMutation.mutate(
                  {
                    id: taskToEdit.activityId,
                    name: taskToEdit.activityName.trim(),
                    phase_id: phaseId,
                    estimated_hours: nonBillable ? 0 : taskToEdit.estimatedHours,
                    default_rate: taskToEdit.defaultRate ?? null,
                  },
                  { onSuccess: () => setTaskToEdit(null) }
                );
              }}
              disabled={!taskToEdit?.activityName.trim() || !taskToEdit?.phaseId || !taskToEdit?.phaseName.trim() || updateActivityMutation.isPending || updatePhaseMutation.isPending}
            >
              {updateActivityMutation.isPending || updatePhaseMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 2, mb: 3, maxWidth: 1600 }}>
        {isAdmin && projectStatus === 'active' && (
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Button
              variant="outlined"
              onClick={() => navigate(`/reporting/project/${projectId}`)}
            >
              View Project Report
            </Button>
          </Box>
        )}
        {isAdmin && projectStatus === 'proposal' && (
          <>
            {!nonBillable && (
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">Estimated revenue</Typography>
                  <Typography variant="h6">{formatCurrency(roundCurrency(summary.revenue))}</Typography>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent>
                <Typography variant="body2" color="text.secondary">Estimated cost</Typography>
                <Typography variant="h6">{formatCurrency(roundCurrency(summary.cost))}</Typography>
              </CardContent>
            </Card>
            {!nonBillable && (
              <>
                <Card>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Estimated profit</Typography>
                    <Typography variant="h6" color={summary.profit >= 0 ? 'success.main' : 'error.main'}>
                      {formatCurrency(roundCurrency(summary.profit))}
                    </Typography>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Estimated margin</Typography>
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
          {isAdmin && (
            <Tab label="Team" id="detail-tab-1" aria-controls="detail-tabpanel-1" />
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
                  <Table
                    size="small"
                    sx={{
                      tableLayout: 'fixed',
                      width: 1,
                      maxWidth: 1411,
                      '& .MuiTableCell-root': { verticalAlign: 'middle', px: 1.5, py: 0.75 },
                    }}
                  >
            <TableHead>
              <TableRow sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
                <TableCell sx={{ width: 90 }} />
                <TableCell sx={{ fontWeight: 700, width: 277 }}>Phase</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 403 }}>Activity</TableCell>
                {!nonBillable && (
                  <TableCell align="right" sx={{ fontWeight: 700, width: 162, pl: 1 }}>Hours</TableCell>
                )}
                {!nonBillable && (
                  <>
                    <TableCell align="right" sx={{ fontWeight: 700, width: 90 }}>Rate ($/hr)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, width: 100 }}>Budget</TableCell>
                  </>
                )}
                <TableCell sx={{ fontWeight: 700, width: 221 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <SortableContext items={taskRows.map((t) => t.activityId)} strategy={verticalListSortingStrategy}>
                {taskRows.map((task, dataIndex) => {
                  const isFirstInPhase = dataIndex === 0 || taskRows[dataIndex - 1].phaseId !== task.phaseId;
                  return (
                    <SortableTaskRow
                      key={task.activityId}
                      id={task.activityId}
                      task={task}
                      isFirstInPhase={isFirstInPhase}
                      showHours={!nonBillable}
                      onEdit={setTaskToEdit}
                      onDuplicate={handleDuplicateGroup}
                      onDelete={handleDeleteTask}
                    />
                  );
                })}
              </SortableContext>
              {taskRows.length > 0 && (
                <TableRow sx={{ fontWeight: 700, bgcolor: 'grey.50', '& .MuiTableCell-root': { fontWeight: 700 } }}>
                  <TableCell sx={{ width: 90 }} />
                  <TableCell sx={{ width: 277 }} />
                  <TableCell sx={{ width: 403 }}>Total</TableCell>
                  {!nonBillable && (
                    <>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 162, pl: 1 }}>
                        {taskRows.reduce((s, t) => s + t.estimatedHours, 0).toFixed(2)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 90 }}>—</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', width: 100 }}>
                        {(() => {
                          const totalBudget = taskRows.reduce(
                            (s, t) => s + getDisplayRateAndRowBudget(t.estimatedHours, t.defaultRate).rowBudget,
                            0
                          );
                          return totalBudget > 0 ? formatCurrency(totalBudget) : '—';
                        })()}
                      </TableCell>
                    </>
                  )}
                  <TableCell sx={{ width: 221 }} />
                </TableRow>
              )}
              {addRowError && (
                <TableRow>
                  <TableCell colSpan={nonBillable ? 4 : 7} sx={{ py: 1, verticalAlign: 'middle' }}>
                    <Alert severity="error" onClose={() => setAddRowError(null)}>
                      {addRowError}
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
              {duplicateError && (
                <TableRow>
                  <TableCell colSpan={nonBillable ? 4 : 7} sx={{ py: 1, verticalAlign: 'middle' }}>
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
                  {!nonBillable && (
                    <TextField
                      type="number"
                      size="small"
                      placeholder="Hours"
                      value={newRow.hours}
                      onChange={(e) => setNewRow((r) => ({ ...r, hours: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && canSave && handleAddRow()}
                      inputProps={{ min: 0, step: 0.5 }}
                      sx={{ width: 100 }}
                    />
                  )}
                  {!nonBillable && (
                    <TextField
                      type="number"
                      size="small"
                      placeholder="Default rate ($/hr)"
                      value={newRow.defaultRate}
                      onChange={(e) => setNewRow((r) => ({ ...r, defaultRate: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && canSave && handleAddRow()}
                      inputProps={{ min: 0, step: 0.01 }}
                      sx={{ width: 110 }}
                    />
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={() => handleAddRow()}
                    disabled={!canSave || createPhaseMutation.isPending || createActivityMutation.isPending}
                  >
                    Save
                  </Button>
                </Box>
              </>
            )}
          </Box>

          {isAdmin && (
            <Box role="tabpanel" id="detail-tabpanel-1" aria-labelledby="detail-tab-1" hidden={detailTab !== 1}>
              {detailTab === 1 && (
                <>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
                    Project team
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Consultants on the team can log time to any task in this project. Add consultants below; set rate overrides for billable projects.
                  </Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                    Add to project
                  </Typography>
                  <Autocomplete
                    key="add-consultant-to-project"
                    multiple
                    disableCloseOnSelect
                    size="small"
                    options={consultantsNotOnTeam}
                    getOptionLabel={(c) => c.name}
                    value={[]}
                    onChange={(_, value) => {
                      if (value.length > 0 && projectId) {
                        addConsultantsToProjectMutation.mutate({ project_id: projectId, consultant_ids: value.map((c) => c.id) });
                      }
                    }}
                    renderOption={(props, option, { selected }) => (
                      <li {...props} key={option.id}>
                        <Checkbox size="small" sx={{ mr: 1 }} checked={selected} />
                        <ListItemText primary={option.name} />
                      </li>
                    )}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Select consultants to add (multiple)" size="small" sx={{ maxWidth: 320 }} />
                    )}
                    sx={{ maxWidth: 320, mb: 2 }}
                  />
                  {teamConsultants.length === 0 && consultantsNotOnTeam.length > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Select one or more consultants above to add them to the project team.
                    </Typography>
                  )}
                  <Table size="small" sx={{ maxWidth: 560, mb: 2, '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Consultant</TableCell>
                        {!nonBillable && (
                          <>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>Default ($/hr)</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>Override ($/hr)</TableCell>
                          </>
                        )}
                        <TableCell width={80} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {teamConsultants.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.name}</TableCell>
                          {!nonBillable && (
                            <>
                              <TableCell align="right">{formatCurrency(Number(c.charge_out_rate))}</TableCell>
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
                            </>
                          )}
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() => projectId && removeConsultantFromProjectMutation.mutate({ project_id: projectId, consultant_id: c.id })}
                              disabled={removeConsultantFromProjectMutation.isPending}
                              aria-label={`Remove ${c.name} from project`}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {teamConsultants.length > 0 && !nonBillable && hasRateOverrideChanges && (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleSaveRateOverrides}
                      disabled={savingOverrides || saveRateOverrideMutation.isPending || clearRateOverrideMutation.isPending}
                      sx={{ mb: 2 }}
                    >
                      {savingOverrides ? 'Saving…' : 'Save rate overrides'}
                    </Button>
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
