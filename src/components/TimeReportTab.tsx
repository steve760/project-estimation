import { useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  LinearProgress,
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TimeEntry } from '../types/database';
import type { Consultant, PhaseWithActivitiesDisplay, ProjectConsultantRate } from '../types/database';

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

interface TaskRow {
  activityId: string;
  activityName: string;
  phaseName: string;
  budgetHours: number;
  spentHours: number;
  remainingHours: number;
  spentCost: number;
}

interface TimeReportTabProps {
  projectId: string;
  phases: PhaseWithActivitiesDisplay[];
  consultants: Consultant[];
  rateOverrides: ProjectConsultantRate[];
}

export function TimeReportTab({
  projectId,
  phases,
  consultants,
  rateOverrides,
}: TimeReportTabProps) {
  void rateOverrides; // reserved for future charge/revenue columns
  const consultantMap = useMemo(() => new Map(consultants.map((c) => [c.id, c])), [consultants]);

  const { data: timeEntries = [], isLoading } = useQuery({
    queryKey: ['time_entries_report', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!projectId,
  });

  const spentByActivity = useMemo(() => {
    const map = new Map<string, { hours: number; cost: number }>();
    for (const e of timeEntries) {
      const cur = map.get(e.activity_id) ?? { hours: 0, cost: 0 };
      const consultant = consultantMap.get(e.consultant_id);
      const costPerHour = consultant != null ? toNum(consultant.cost_per_hour) : 0;
      const hours = toNum(e.hours);
      map.set(e.activity_id, {
        hours: cur.hours + hours,
        cost: cur.cost + hours * costPerHour,
      });
    }
    return map;
  }, [timeEntries, consultantMap]);

  const rows: TaskRow[] = useMemo(() => {
    const out: TaskRow[] = [];
    for (const phase of phases) {
      for (const activity of phase.activities ?? []) {
        const budgetHours = toNum(activity.estimated_hours ?? 0);
        const spent = spentByActivity.get(activity.id) ?? { hours: 0, cost: 0 };
        const spentHours = spent.hours;
        const remainingHours = budgetHours - spentHours;
        out.push({
          activityId: activity.id,
          activityName: activity.name,
          phaseName: phase.name,
          budgetHours,
          spentHours,
          remainingHours,
          spentCost: spent.cost,
        });
      }
    }
    return out;
  }, [phases, spentByActivity]);

  const exportCsv = useCallback(() => {
    const header = 'Phase,Task,Budget (hrs),Spent (hrs),Remaining (hrs),Spent cost ($)';
    const lines = rows.map(
      (r) =>
        `"${r.phaseName.replace(/"/g, '""')}","${r.activityName.replace(/"/g, '""')}",${r.budgetHours.toFixed(1)},${r.spentHours.toFixed(1)},${r.remainingHours.toFixed(1)},${r.spentCost.toFixed(2)}`
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-report-${projectId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, projectId]);

  if (isLoading) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography color="text.secondary">Loading report…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Time by task
        </Typography>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>
          Export CSV
        </Button>
      </Box>

      <Table size="small" sx={{ '& .MuiTableCell-root': { verticalAlign: 'middle' } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Phase</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Task</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Budget (hrs)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Spent (hrs)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Remaining</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Progress</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const pct = row.budgetHours > 0 ? (row.spentHours / row.budgetHours) * 100 : 0;
            return (
              <TableRow key={row.activityId}>
                <TableCell>{row.phaseName}</TableCell>
                <TableCell>{row.activityName}</TableCell>
                <TableCell align="right">{row.budgetHours.toFixed(1)}</TableCell>
                <TableCell align="right">{row.spentHours.toFixed(1)}</TableCell>
                <TableCell align="right">{row.remainingHours.toFixed(1)}</TableCell>
                <TableCell align="right">${row.spentCost.toFixed(2)}</TableCell>
                <TableCell sx={{ minWidth: 140 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, pct)}
                      color={pct > 100 ? 'error' : 'primary'}
                      sx={{ flex: 1, height: 8, borderRadius: 1 }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32 }}>
                      {pct.toFixed(0)}%
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          No activities on this project yet. Add phases and activities in the Project Activities tab.
        </Typography>
      )}
    </Box>
  );
}
