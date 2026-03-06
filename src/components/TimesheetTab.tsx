import { useState, useMemo, useCallback, Fragment } from 'react';
import {
  Box,
  Button,
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
  ListSubheader,
  Divider,
} from '@mui/material';
import { Add as AddIcon, Save as SaveIcon, Close as CloseIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TimePeriodNavigator } from './TimePeriodNavigator';
import { supabase } from '../lib/supabase';
import type { TimeEntry } from '../types/database';
import type { PhaseWithActivitiesDisplay } from '../types/database';

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
  end.setDate(start.getDate() + 4); // Friday
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  const fmt = (x: Date) => x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${fmt(weekStart)} – ${fmt(weekEnd)} (Mon–Fri)`;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_COUNT = 5; // Mon–Fri
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

interface TimesheetTabProps {
  projectId: string;
  projectName: string;
  phases: PhaseWithActivitiesDisplay[];
  isAdmin: boolean;
  consultantId: string | null;
  projectConsultants: { id: string; name: string }[];
}

export function TimesheetTab({
  projectId,
  projectName,
  phases,
  isAdmin,
  consultantId,
  projectConsultants,
}: TimesheetTabProps) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedConsultantId, setSelectedConsultantId] = useState<string | null>(consultantId);
  const [addedActivityIds, setAddedActivityIds] = useState<string[]>([]);
  const [gridHours, setGridHours] = useState<Record<string, Record<string, number>>>({});
  const [addRowAnchor, setAddRowAnchor] = useState<null | HTMLElement>(null);

  const effectiveConsultantId = isAdmin ? selectedConsultantId : consultantId;
  const weekStartStr = toISODate(weekStart);
  const weekEnd = getWeekEnd(weekStart);
  const weekEndStr = toISODate(weekEnd);

  // Previous week's date range (Mon–Fri) for "Add rows from last week"
  const prevWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    return d;
  }, [weekStart]);
  const prevWeekStartStr = toISODate(prevWeekStart);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);
  const prevWeekEndStr = toISODate(prevWeekEnd);

  const { data: timeEntries = [], isLoading } = useQuery({
    queryKey: ['time_entries', projectId, effectiveConsultantId, weekStartStr],
    queryFn: async () => {
      if (!effectiveConsultantId) return [];
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', projectId)
        .eq('consultant_id', effectiveConsultantId)
        .gte('entry_date', weekStartStr)
        .lte('entry_date', weekEndStr);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!projectId && !!effectiveConsultantId,
  });

  const { data: prevWeekEntries = [] } = useQuery({
    queryKey: ['time_entries', projectId, effectiveConsultantId, prevWeekStartStr],
    queryFn: async () => {
      if (!effectiveConsultantId) return [];
      const { data, error } = await supabase
        .from('time_entries')
        .select('activity_id')
        .eq('project_id', projectId)
        .eq('consultant_id', effectiveConsultantId)
        .gte('entry_date', prevWeekStartStr)
        .lte('entry_date', prevWeekEndStr);
      if (error) throw error;
      return (data ?? []) as { activity_id: string }[];
    },
    enabled: !!projectId && !!effectiveConsultantId,
  });

  const activityIdsFromPrevWeek = useMemo(
    () => [...new Set(prevWeekEntries.map((e) => e.activity_id))],
    [prevWeekEntries]
  );

  const saveTimeEntriesMutation = useMutation({
    mutationFn: async (entries: { activity_id: string; entry_date: string; hours: number }[]) => {
      if (!effectiveConsultantId) return;
      for (const { activity_id, entry_date, hours } of entries) {
        if (hours > 0) {
          const { error } = await supabase.from('time_entries').upsert(
            { consultant_id: effectiveConsultantId, project_id: projectId, activity_id, entry_date, hours, notes: null },
            { onConflict: 'consultant_id,project_id,activity_id,entry_date' }
          );
          if (error) throw error;
        } else {
          await supabase
            .from('time_entries')
            .delete()
            .eq('consultant_id', effectiveConsultantId)
            .eq('project_id', projectId)
            .eq('activity_id', activity_id)
            .eq('entry_date', entry_date);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time_entries', projectId, effectiveConsultantId, weekStartStr] });
    },
  });

  const activityList = useMemo(() => {
    const out: { id: string; phaseName: string; activityName: string }[] = [];
    for (const phase of phases) {
      for (const activity of phase.activities ?? []) {
        out.push({ id: activity.id, phaseName: phase.name, activityName: activity.name });
      }
    }
    return out;
  }, [phases]);

  const activityIdToInfo = useMemo(() => new Map(activityList.map((a) => [a.id, a])), [activityList]);

  const activityIdsInWeek = useMemo(() => {
    const ids = new Set<string>();
    for (const e of timeEntries) {
      if (e.hours > 0) ids.add(e.activity_id);
    }
    return ids;
  }, [timeEntries]);

  const rows = useMemo(() => {
    const ids = new Set<string>([...activityIdsInWeek, ...addedActivityIds]);
    return Array.from(ids).map((id) => ({ activityId: id, ...activityIdToInfo.get(id)! })).filter((r) => r.activityName);
  }, [activityIdsInWeek, addedActivityIds, activityIdToInfo]);

  const gridState = useMemo(() => {
    const state: Record<string, Record<string, number>> = {};
    for (const e of timeEntries) {
      if (!state[e.activity_id]) state[e.activity_id] = {};
      state[e.activity_id][e.entry_date] = e.hours;
    }
    for (const r of rows) {
      if (!state[r.activityId]) state[r.activityId] = {};
      for (let i = 0; i < WEEKDAY_COUNT; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const key = toISODate(d);
        if (state[r.activityId][key] === undefined) state[r.activityId][key] = gridHours[r.activityId]?.[key] ?? 0;
      }
    }
    return { ...state, ...gridHours };
  }, [timeEntries, rows, weekStart, gridHours]);

  const setCellHours = useCallback((activityId: string, dateStr: string, value: number) => {
    setGridHours((prev) => ({
      ...prev,
      [activityId]: { ...(prev[activityId] ?? {}), [dateStr]: value },
    }));
  }, []);

  const handleSave = useCallback(() => {
    if (!effectiveConsultantId) return;
    const entries: { activity_id: string; entry_date: string; hours: number }[] = [];
    for (const row of rows) {
      for (let i = 0; i < WEEKDAY_COUNT; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const dateStr = toISODate(d);
        const hours = Number(gridState[row.activityId]?.[dateStr]) || 0;
        entries.push({ activity_id: row.activityId, entry_date: dateStr, hours });
      }
    }
    saveTimeEntriesMutation.mutate(entries);
  }, [effectiveConsultantId, rows, weekStart, gridState, saveTimeEntriesMutation]);

  const activitiesNotOnSheet = useMemo(() => {
    const onSheet = new Set(rows.map((r) => r.activityId));
    return activityList.filter((a) => !onSheet.has(a.id));
  }, [rows, activityList]);

  const activitiesNotOnSheetByPhase = useMemo(() => {
    const map = new Map<string, typeof activityList>();
    for (const a of activitiesNotOnSheet) {
      const phase = a.phaseName ?? '—';
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase)!.push(a);
    }
    return Array.from(map.entries()).map(([phaseName, activities]) => ({ phaseName, activities }));
  }, [activitiesNotOnSheet]);

  const activitiesFromPrevWeekNotOnSheet = useMemo(() => {
    const onSheet = new Set(rows.map((r) => r.activityId));
    return activityIdsFromPrevWeek.filter((id) => !onSheet.has(id));
  }, [rows, activityIdsFromPrevWeek]);

  const addRowsFromLastWeek = useCallback(() => {
    setAddedActivityIds((prev) => [...new Set([...prev, ...activitiesFromPrevWeekNotOnSheet])]);
    setAddRowAnchor(null);
  }, [activitiesFromPrevWeekNotOnSheet]);

  const removeRow = useCallback((activityId: string) => {
    setAddedActivityIds((prev) => prev.filter((id) => id !== activityId));
    setGridHours((prev) => {
      const next = { ...prev };
      delete next[activityId];
      return next;
    });
    const entries = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return { activity_id: activityId, entry_date: toISODate(d), hours: 0 };
    });
    saveTimeEntriesMutation.mutate(entries);
  }, [weekStart, saveTimeEntriesMutation]);

  if (!effectiveConsultantId) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography color="text.secondary">
          Link your account to a consultant (via your profile) to log time, or select a teammate above.
        </Typography>
      </Box>
    );
  }

  const weekDates = Array.from({ length: WEEKDAY_COUNT }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TimePeriodNavigator
            label={`This week: ${formatWeekLabel(weekStart)}`}
            onPrevious={() => setWeekStart((d) => getWeekStart(new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000)))}
            onNext={() => setWeekStart((d) => getWeekStart(new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000)))}
            previousAriaLabel="Previous week"
            nextAriaLabel="Next week"
          />
        </Box>
        {isAdmin && projectConsultants.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Teammates</InputLabel>
            <Select
              value={selectedConsultantId ?? ''}
              label="Teammates"
              onChange={(e) => setSelectedConsultantId(e.target.value || null)}
            >
              {projectConsultants.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      {isLoading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <>
          <Table size="small" sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' }, mb: 2 }}>
            <TableHead>
              <TableRow>
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
              {rows.map((row) => {
                const rowTotal = weekDates.reduce(
                  (sum, d) => sum + (Number(gridState[row.activityId]?.[toISODate(d)]) || 0),
                  0
                );
                return (
                  <TableRow key={row.activityId}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{row.activityName}</Typography>
                      <Typography variant="caption" color="text.secondary">{row.phaseName}</Typography>
                    </TableCell>
                    {weekDates.map((d) => {
                      const dateStr = toISODate(d);
                      const val = gridState[row.activityId]?.[dateStr] ?? 0;
                      return (
                        <TableCell key={dateStr} align="center">
                          <TextField
                            type="number"
                            size="small"
                            inputProps={{ min: 0, step: 0.5 }}
                            value={val || ''}
                            onChange={(e) => setCellHours(row.activityId, dateStr, Number(e.target.value) || 0)}
                            sx={{ width: 64 }}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell align="right">{rowTotal.toFixed(1)}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => removeRow(row.activityId)} title="Remove row">
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
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
            >
              {activitiesNotOnSheetByPhase.map(({ phaseName, activities }) => (
                <Fragment key={phaseName}>
                  <ListSubheader component="div" sx={{ fontWeight: 700, lineHeight: 2 }}>
                    {phaseName}
                  </ListSubheader>
                  <Divider />
                  {activities.map((a) => (
                    <MenuItem
                      key={a.id}
                      onClick={() => {
                        setAddedActivityIds((prev) => [...prev, a.id]);
                        setAddRowAnchor(null);
                      }}
                    >
                      {a.activityName}
                    </MenuItem>
                  ))}
                </Fragment>
              ))}
            </Menu>
            {activitiesFromPrevWeekNotOnSheet.length > 0 && (
              <Button
                variant="outlined"
                size="small"
                onClick={addRowsFromLastWeek}
              >
                Add rows from last week
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={saveTimeEntriesMutation.isPending}
            >
              {saveTimeEntriesMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
