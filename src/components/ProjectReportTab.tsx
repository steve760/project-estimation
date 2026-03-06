import { useMemo } from 'react';
import { Box, Card, CardContent, Typography, Table, TableBody, TableCell, TableRow, TableHead } from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TimeEntry } from '../types/database';
import type { Consultant, PhaseWithActivitiesDisplay, ProjectConsultantRate } from '../types/database';

function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

interface ProjectReportTabProps {
  projectId: string;
  phases: PhaseWithActivitiesDisplay[];
  consultants: Consultant[];
  rateOverrides: ProjectConsultantRate[];
}

export function ProjectReportTab({
  projectId,
  consultants,
  rateOverrides,
}: ProjectReportTabProps) {
  const consultantMap = useMemo(() => new Map(consultants.map((c) => [c.id, c])), [consultants]);
  const overrideMap = useMemo(
    () => new Map(rateOverrides.map((r) => [r.consultant_id, toNum(r.charge_out_rate)])),
    [rateOverrides]
  );

  const { data: timeEntries = [], isLoading } = useQuery({
    queryKey: ['time_entries_report', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', projectId)
        .order('entry_date');
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!projectId,
  });

  const { cumulativeByDate, totalHours, internalCost, revenueToDate } = useMemo(() => {
    const byDate = new Map<string, number>();
    let total = 0;
    let cost = 0;
    let revenue = 0;
    for (const e of timeEntries) {
      const hours = toNum(e.hours);
      const d = e.entry_date;
      byDate.set(d, (byDate.get(d) ?? 0) + hours);
      total += hours;
      const consultant = consultantMap.get(e.consultant_id);
      if (consultant) {
        const costPerHr = toNum(consultant.cost_per_hour);
        const rate = toNum(overrideMap.get(e.consultant_id) ?? consultant.charge_out_rate);
        cost += hours * costPerHr;
        revenue += hours * rate;
      }
    }
    const sortedDates = Array.from(byDate.keys()).sort();
    const cumulativeByDate = sortedDates.reduce<{ date: string; hours: number; cumulative: number }[]>(
      (acc, date) => {
        const hours = byDate.get(date) ?? 0;
        const cumulative = (acc[acc.length - 1]?.cumulative ?? 0) + hours;
        return [...acc, { date, hours, cumulative }];
      },
      []
    );
    return {
      cumulativeByDate,
      totalHours: total,
      internalCost: cost,
      revenueToDate: revenue,
    };
  }, [timeEntries, consultantMap, overrideMap]);

  if (isLoading) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography color="text.secondary">Loading report…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
        Project progress
      </Typography>
      {cumulativeByDate.length > 0 ? (
        <Box sx={{ height: 260, mb: 3 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeByDate} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                formatter={(value: number | undefined) => [value ?? 0, 'Hours']}
                labelFormatter={(label) => `Date: ${label}`}
                cursor={false}
              />
              <Line type="monotone" dataKey="cumulative" name="Cumulative hours" stroke="#1976d2" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No time logged yet. Log time in the Timesheet tab to see progress.
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Card variant="outlined" sx={{ minWidth: 140 }}>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Total hours</Typography>
            <Typography variant="h6">{totalHours.toFixed(1)}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ minWidth: 140 }}>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Internal costs (from time)</Typography>
            <Typography variant="h6">${internalCost.toFixed(2)}</Typography>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ minWidth: 140 }}>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Revenue to date (from time)</Typography>
            <Typography variant="h6">${revenueToDate.toFixed(2)}</Typography>
          </CardContent>
        </Card>
      </Box>

      {cumulativeByDate.length > 0 && (
        <>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Hours by date</Typography>
          <Table size="small" sx={{ maxWidth: 400 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Hours</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Cumulative</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cumulativeByDate.map((row) => (
                <TableRow key={row.date}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell align="right">{row.hours.toFixed(1)}</TableCell>
                  <TableCell align="right">{row.cumulative.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Box>
  );
}
