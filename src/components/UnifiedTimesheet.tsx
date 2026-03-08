import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  TextField,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Menu,
  CircularProgress,
  ListSubheader,
} from '@mui/material';
import { Add as AddIcon, Close as CloseIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { TimePeriodNavigator } from './TimePeriodNavigator';
import type { TimeEntry } from '../types/database';

function getWeekStart(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getWeekEnd(d: Date): Date {
  const start = getWeekStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  const startDay = weekStart.toLocaleDateString('en-GB', { day: '2-digit' });
  const endDay = weekEnd.toLocaleDateString('en-GB', { day: '2-digit' });
  const monthYear = weekStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return `${startDay} – ${endDay} ${monthYear}`;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_COUNT = 5;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function rowKey(projectId: string, activityId: string): string {
  return `${projectId}|${activityId}`;
}

interface ProjectWithClient {
  id: string;
  name: string;
  client_id: string;
  client?: { id: string; name: string } | null;
}

interface ActivityOption {
  projectId: string;
  projectName: string;
  clientName: string;
  activityId: string;
  phaseName: string;
  activityName: string;
}

interface UnifiedTimesheetProps {
  projects: ProjectWithClient[];
  consultantId: string | null;
  isAdmin: boolean;
}

export function UnifiedTimesheet({ projects, consultantId, isAdmin }: UnifiedTimesheetProps) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedConsultantId, setSelectedConsultantId] = useState<string | null>(consultantId);
  const [addedRows, setAddedRows] = useState<{ projectId: string; activityId: string }[]>([]);
  const [gridHours, setGridHours] = useState<Record<string, Record<string, number>>>({});
  const [addRowAnchor, setAddRowAnchor] = useState<null | HTMLElement>(null);

  const effectiveConsultantId = isAdmin ? selectedConsultantId : consultantId;
  const weekStartStr = toISODate(weekStart);
  const weekEnd = getWeekEnd(weekStart);
  const weekEndStr = toISODate(weekEnd);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const { data: consultants = [] } = useQuery({
    queryKey: ['consultants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('consultants').select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: isAdmin && projectIds.length > 0,
  });

  const { data: phasesList = [] } = useQuery({
    queryKey: ['phases-for-projects', projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await supabase
        .from('phases')
        .select('id, project_id, name')
        .in('project_id', projectIds)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as { id: string; project_id: string; name: string }[];
    },
    enabled: projectIds.length > 0,
  });

  const phaseIds = useMemo(() => phasesList.map((p) => p.id), [phasesList]);

  const { data: activitiesList = [] } = useQuery({
    queryKey: ['activities-for-phases', phaseIds],
    queryFn: async () => {
      if (phaseIds.length === 0) return [];
      const { data, error } = await supabase
        .from('activities')
        .select('id, phase_id, name')
        .in('phase_id', phaseIds)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as { id: string; phase_id: string; name: string }[];
    },
    enabled: phaseIds.length > 0,
  });

  const phaseMap = useMemo(() => new Map(phasesList.map((p) => [p.id, p])), [phasesList]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const activityOptions = useMemo((): ActivityOption[] => {
    const out: ActivityOption[] = [];
    for (const a of activitiesList) {
      const phase = phaseMap.get(a.phase_id);
      const proj = phase && projectMap.get(phase.project_id);
      if (!phase || !proj) continue;
      const clientName = (proj.client as { name?: string })?.name ?? '—';
      out.push({
        projectId: phase.project_id,
        projectName: proj.name,
        clientName,
        activityId: a.id,
        phaseName: phase.name,
        activityName: a.name,
      });
    }
    return out;
  }, [activitiesList, phaseMap, projectMap]);

  const { data: timeEntries = [], isLoading } = useQuery({
    queryKey: ['time_entries_unified', effectiveConsultantId, weekStartStr],
    queryFn: async () => {
      if (!effectiveConsultantId) return [];
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('consultant_id', effectiveConsultantId)
        .gte('entry_date', weekStartStr)
        .lte('entry_date', weekEndStr);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!effectiveConsultantId,
  });

  const prevWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    return d;
  }, [weekStart]);
  const prevWeekStartStr = toISODate(prevWeekStart);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);
  const prevWeekEndStr = toISODate(prevWeekEnd);

  const { data: prevWeekEntries = [] } = useQuery({
    queryKey: ['time_entries_unified', effectiveConsultantId, prevWeekStartStr],
    queryFn: async () => {
      if (!effectiveConsultantId) return [];
      const { data, error } = await supabase
        .from('time_entries')
        .select('project_id, activity_id')
        .eq('consultant_id', effectiveConsultantId)
        .gte('entry_date', prevWeekStartStr)
        .lte('entry_date', prevWeekEndStr);
      if (error) throw error;
      return (data ?? []) as { project_id: string; activity_id: string }[];
    },
    enabled: !!effectiveConsultantId,
  });

  const activityIdsFromPrevWeek = useMemo(
    () => [...new Set(prevWeekEntries.map((e) => rowKey(e.project_id, e.activity_id)))],
    [prevWeekEntries]
  );

  const rowsByProject = useMemo(() => {
    const projectRows = new Map<string, ActivityOption[]>();
    const seen = new Set<string>();

    for (const e of timeEntries) {
      if (e.hours > 0) {
        const key = rowKey(e.project_id, e.activity_id);
        if (seen.has(key)) continue;
        seen.add(key);
        const opt = activityOptions.find((o) => o.projectId === e.project_id && o.activityId === e.activity_id);
        if (opt) {
          const list = projectRows.get(e.project_id) ?? [];
          if (!list.some((r) => r.activityId === e.activity_id)) list.push(opt);
          projectRows.set(e.project_id, list);
        }
      }
    }
    for (const { projectId, activityId } of addedRows) {
      const key = rowKey(projectId, activityId);
      if (seen.has(key)) continue;
      seen.add(key);
      const opt = activityOptions.find((o) => o.projectId === projectId && o.activityId === activityId);
      if (opt) {
        const list = projectRows.get(projectId) ?? [];
        if (!list.some((r) => r.activityId === activityId)) list.push(opt);
        projectRows.set(projectId, list);
      }
    }
    return projectRows;
  }, [timeEntries, addedRows, activityOptions]);

  const gridState = useMemo(() => {
    const state: Record<string, Record<string, number>> = {};
    for (const e of timeEntries) {
      const key = rowKey(e.project_id, e.activity_id);
      if (!state[key]) state[key] = {};
      state[key][e.entry_date] = e.hours;
    }
    const weekDates = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return toISODate(d);
    });
    for (const [, list] of rowsByProject) {
      for (const opt of list) {
        const key = rowKey(opt.projectId, opt.activityId);
        if (!state[key]) state[key] = {};
        for (const dateStr of weekDates) {
          if (state[key][dateStr] === undefined)
            state[key][dateStr] = gridHours[key]?.[dateStr] ?? 0;
        }
      }
    }
    const merged = { ...state };
    for (const key of Object.keys(gridHours)) {
      merged[key] = { ...(merged[key] ?? {}), ...gridHours[key] };
    }
    return merged;
  }, [timeEntries, rowsByProject, weekStart, gridHours]);

  const setCellHours = useCallback((projectId: string, activityId: string, dateStr: string, value: number) => {
    const key = rowKey(projectId, activityId);
    setGridHours((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [dateStr]: value },
    }));
  }, []);

  const saveTimeEntriesMutation = useMutation({
    mutationFn: async (entries: { project_id: string; activity_id: string; entry_date: string; hours: number }[]) => {
      if (!effectiveConsultantId) return;
      for (const { project_id, activity_id, entry_date, hours } of entries) {
        if (hours > 0) {
          const { error } = await supabase.from('time_entries').upsert(
            { consultant_id: effectiveConsultantId, project_id, activity_id, entry_date, hours, notes: null },
            { onConflict: 'consultant_id,project_id,activity_id,entry_date' }
          );
          if (error) throw error;
        } else {
          await supabase
            .from('time_entries')
            .delete()
            .eq('consultant_id', effectiveConsultantId)
            .eq('project_id', project_id)
            .eq('activity_id', activity_id)
            .eq('entry_date', entry_date);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time_entries_unified', effectiveConsultantId, weekStartStr] });
      queryClient.invalidateQueries({ queryKey: ['time_entries'] });
    },
  });

  const handleSave = useCallback(() => {
    if (!effectiveConsultantId) return;
    const entries: { project_id: string; activity_id: string; entry_date: string; hours: number }[] = [];
    const weekDates = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return toISODate(d);
    });
    for (const [, list] of rowsByProject) {
      for (const opt of list) {
        const key = rowKey(opt.projectId, opt.activityId);
        for (const dateStr of weekDates) {
          const hours = Number(gridState[key]?.[dateStr]) || 0;
          entries.push({ project_id: opt.projectId, activity_id: opt.activityId, entry_date: dateStr, hours });
        }
      }
    }
    const allowedProjectIds = new Set(projectIds);
    const entriesToSave = isAdmin ? entries : entries.filter((e) => allowedProjectIds.has(e.project_id));
    saveTimeEntriesMutation.mutate(entriesToSave);
  }, [effectiveConsultantId, rowsByProject, weekStart, gridState, saveTimeEntriesMutation, isAdmin, projectIds]);

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const hasUserChanges = Object.keys(gridHours).length > 0;
    if (!hasUserChanges) return;
    const t = window.setTimeout(() => {
      saveRef.current();
    }, 600);
    return () => clearTimeout(t);
  }, [gridHours]);

  const onAddRow = useCallback((opt: ActivityOption) => {
    setAddedRows((prev) => [...prev, { projectId: opt.projectId, activityId: opt.activityId }]);
    setAddRowAnchor(null);
  }, []);

  const onRemoveRow = useCallback((projectId: string, activityId: string) => {
    setAddedRows((prev) => prev.filter((r) => !(r.projectId === projectId && r.activityId === activityId)));
    const key = rowKey(projectId, activityId);
    setGridHours((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const weekDates = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return toISODate(d);
    });
    const entries = weekDates.map((entry_date) => ({
      project_id: projectId,
      activity_id: activityId,
      entry_date,
      hours: 0,
    }));
    saveTimeEntriesMutation.mutate(entries);
  }, [weekStart, saveTimeEntriesMutation]);

  const onSheetKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [, list] of rowsByProject) for (const r of list) set.add(rowKey(r.projectId, r.activityId));
    return set;
  }, [rowsByProject]);

  const activitiesNotOnSheet = useMemo(
    () => activityOptions.filter((o) => !onSheetKeys.has(rowKey(o.projectId, o.activityId))),
    [activityOptions, onSheetKeys]
  );

  const activitiesNotOnSheetByProject = useMemo(() => {
    const map = new Map<string, { projectName: string; options: ActivityOption[] }>();
    for (const opt of activitiesNotOnSheet) {
      const existing = map.get(opt.projectId);
      if (!existing) map.set(opt.projectId, { projectName: opt.projectName, options: [opt] });
      else existing.options.push(opt);
    }
    return Array.from(map.entries()).map(([projectId, data]) => ({ projectId, ...data }));
  }, [activitiesNotOnSheet]);

  const activitiesNotOnSheetByProjectAndPhase = useMemo(() => {
    return activitiesNotOnSheetByProject.map(({ projectId, projectName, options }) => {
      const byPhase = new Map<string, ActivityOption[]>();
      for (const opt of options) {
        const phase = opt.phaseName ?? '—';
        if (!byPhase.has(phase)) byPhase.set(phase, []);
        byPhase.get(phase)!.push(opt);
      }
      const phases = Array.from(byPhase.entries()).map(([phaseName, opts]) => ({ phaseName, options: opts }));
      return { projectId, projectName, phases };
    });
  }, [activitiesNotOnSheetByProject]);

  const activitiesFromPrevWeekNotOnSheet = useMemo(
    () =>
      activityIdsFromPrevWeek.filter((key) => !onSheetKeys.has(key)),
    [activityIdsFromPrevWeek, onSheetKeys]
  );

  const addRowsFromLastWeek = useCallback(() => {
    for (const key of activitiesFromPrevWeekNotOnSheet) {
      const [projectId, activityId] = key.split('|');
      const opt = activityOptions.find((o) => o.projectId === projectId && o.activityId === activityId);
      if (opt) setAddedRows((prev) => [...prev, { projectId, activityId }]);
    }
    setAddRowAnchor(null);
  }, [activitiesFromPrevWeekNotOnSheet, activityOptions]);

  if (!effectiveConsultantId) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography color="text.secondary">
          Link your account to a consultant on the Consultants page to log time, or select a teammate above.
        </Typography>
      </Box>
    );
  }

  const weekDates = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const projectOrder = useMemo(() => {
    const order: string[] = [];
    const set = new Set(rowsByProject.keys());
    for (const p of projects) {
      if (set.has(p.id)) order.push(p.id);
    }
    return order;
  }, [projects, rowsByProject]);

  return (
    <Card sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <TimePeriodNavigator
            label={`This week: ${formatWeekLabel(weekStart)}`}
            onPrevious={() => setWeekStart((d) => getWeekStart(new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000)))}
            onNext={() => setWeekStart((d) => getWeekStart(new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000)))}
            previousAriaLabel="Previous week"
            nextAriaLabel="Next week"
          />
          {isAdmin && consultants.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Consultant</InputLabel>
              <Select
                value={selectedConsultantId ?? ''}
                label="Consultant"
                onChange={(e) => setSelectedConsultantId(e.target.value || null)}
              >
                {consultants.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Loading…</Typography>
          </Box>
        ) : projectOrder.length === 0 && activitiesNotOnSheet.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No activities yet. Use &quot;Add row&quot; to log time for a project task.
          </Typography>
        ) : (
          <>
            <Table
              size="small"
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
                '& .MuiTableCell-root': { verticalAlign: 'middle', borderColor: 'divider' },
                '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: 'grey.50', fontWeight: 700 },
                '& .MuiTableRow-root:hover': { bgcolor: 'action.hover' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Task</TableCell>
                  {weekDates.map((d, i) => (
                    <TableCell key={toISODate(d)} align="center" sx={{ fontWeight: 700 }}>
                      {DAY_LABELS[i]} {d.getDate()} {d.toLocaleDateString('en-GB', { month: 'short' })}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell width={40} />
                </TableRow>
              </TableHead>
              <TableBody>
                {projectOrder.flatMap((projectId) => {
                  const project = projectMap.get(projectId);
                  const rows = rowsByProject.get(projectId) ?? [];
                  if (!project || rows.length === 0) return [];
                  const projectLabel = `${(project.client as { name?: string })?.name ?? '—'} – ${project.name}`;
                  return rows.map((opt) => {
                    const key = rowKey(opt.projectId, opt.activityId);
                    const rowTotal = weekDates.reduce(
                      (sum, d) => sum + (Number(gridState[key]?.[toISODate(d)]) || 0),
                      0
                    );
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>{projectLabel}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>{opt.activityName}</Typography>
                          <Typography variant="caption" color="text.secondary">{opt.phaseName}</Typography>
                        </TableCell>
                        {weekDates.map((d) => {
                          const dateStr = toISODate(d);
                          const val = gridState[key]?.[dateStr] ?? 0;
                          return (
                            <TableCell key={dateStr} align="center">
                              <TextField
                                type="number"
                                size="small"
                                inputProps={{ min: 0, step: 0.5 }}
                                value={val || ''}
                                onChange={(e) =>
                                  setCellHours(opt.projectId, opt.activityId, dateStr, Number(e.target.value) || 0)
                                }
                                sx={{ width: 64 }}
                              />
                            </TableCell>
                          );
                        })}
                        <TableCell align="right">{rowTotal.toFixed(1)}</TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => onRemoveRow(opt.projectId, opt.activityId)}
                            title="Remove row"
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  });
                })}
              </TableBody>
            </Table>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 2, pt: 1 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={(e) => setAddRowAnchor(e.currentTarget)}
                disabled={activitiesNotOnSheet.length === 0}
              >
                Add row
              </Button>
              <Menu
                anchorEl={addRowAnchor}
                open={!!addRowAnchor}
                onClose={() => setAddRowAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                sx={{ maxHeight: 400, '& .MuiList-root': { py: 0 } }}
                PaperProps={{ sx: { py: 1 } }}
              >
                {activitiesNotOnSheetByProjectAndPhase.map(({ projectId, projectName, phases }) => (
                  <Fragment key={projectId}>
                    <ListSubheader
                      component="div"
                      sx={{
                        fontWeight: 700,
                        lineHeight: 2,
                        py: 1,
                        px: 2,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                      }}
                    >
                      {projectName}
                    </ListSubheader>
                    {phases.map(({ phaseName, options }) => (
                      <Fragment key={`${projectId}-${phaseName}`}>
                        <ListSubheader component="div" sx={{ fontWeight: 700, fontSize: '0.8125rem', lineHeight: 1.8, py: 0.75, px: 2 }}>
                          {phaseName}
                        </ListSubheader>
                        {options.map((opt) => (
                          <MenuItem
                            key={rowKey(opt.projectId, opt.activityId)}
                            onClick={() => onAddRow(opt)}
                            sx={{ py: 1.25 }}
                          >
                            {opt.activityName}
                          </MenuItem>
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </Menu>
              {activitiesFromPrevWeekNotOnSheet.length > 0 && (
                <Button variant="outlined" size="small" onClick={addRowsFromLastWeek}>
                  Add rows from last week
                </Button>
              )}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
