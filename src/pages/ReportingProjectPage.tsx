import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { TimePeriodNavigator } from '../components/TimePeriodNavigator';
import { useAuth } from '../contexts/AuthContext';
import type { TimeEntry } from '../types/database';
import type { Consultant, Phase, Activity, ProjectConsultantRate } from '../types/database';

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getMonthEnd(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Coerce API values (Supabase may return numeric as string) to number to avoid NaN. */
function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function formatMonthRange(d: Date): string {
  const start = getMonthStart(d);
  const end = getMonthEnd(d);
  return `${start.getDate().toString().padStart(2, '0')} – ${end.getDate().toString().padStart(2, '0')} ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
}

/** Format date as YYYY-MM-DD in local time (avoids timezone shifting the month). */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ReportingProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { isAdmin, profileLoading, consultantId } = useAuth();
  const theme = useTheme();
  const monthParam = searchParams.get('month'); // YYYY-MM
  const [month, setMonth] = useState(() => {
    if (monthParam) {
      const [y, m] = monthParam.split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) return new Date(y, m - 1, 1);
    }
    return getMonthStart(new Date());
  });
  const [viewMode, setViewMode] = useState<'monthly' | 'wholeOfLife'>('monthly');

  const monthStartStr = toDateString(getMonthStart(month));
  const monthEndStr = toDateString(getMonthEnd(month));
  const isWholeOfLife = viewMode === 'wholeOfLife';

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['reporting-project', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project');
      const { data: proj, error: pe } = await supabase
        .from('projects')
        .select('id, name, client_id, status, non_billable, client:clients(id, name)')
        .eq('id', projectId)
        .single();
      if (pe || !proj) throw new Error(pe?.message ?? 'Project not found');
      const raw = proj as { id: string; name: string; client_id: string; status?: string; non_billable?: boolean; client: { id: string; name: string } | { id: string; name: string }[] };
      const client = Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client;
      return { id: raw.id, name: raw.name, client_id: raw.client_id, status: raw.status ?? 'active', non_billable: raw.non_billable ?? false, client };
    },
    enabled: !!projectId && !profileLoading,
  });

  const { data: projectStructure, isLoading: structureLoading } = useQuery({
    queryKey: ['reporting-project-structure', projectId],
    queryFn: async () => {
      if (!projectId) return { phases: [] as Phase[], activities: [] as Activity[], assignments: [] as { activity_id: string; hours: unknown }[] };
      const { data: phases, error: e1 } = await supabase
        .from('phases')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order');
      if (e1) throw e1;
      const phaseList = (phases ?? []) as Phase[];
      const phaseIds = phaseList.map((p) => p.id);
      if (phaseIds.length === 0) return { phases: phaseList, activities: [] as Activity[], assignments: [] as { activity_id: string; hours: unknown }[] };
      const { data: activitiesData, error: e2 } = await supabase
        .from('activities')
        .select('*')
        .in('phase_id', phaseIds)
        .order('sort_order');
      if (e2) throw e2;
      const activityList = (activitiesData ?? []) as Activity[];
      const activityIds = activityList.map((a) => a.id);
      if (activityIds.length === 0) return { phases: phaseList, activities: activityList, assignments: [] as { activity_id: string; hours: unknown }[] };
      const { data: assignmentsData, error: e3 } = await supabase
        .from('activity_assignments')
        .select('activity_id, hours')
        .in('activity_id', activityIds);
      if (e3) throw e3;
      return { phases: phaseList, activities: activityList, assignments: (assignmentsData ?? []) as { activity_id: string; hours: unknown }[] };
    },
    enabled: !!projectId && !profileLoading,
  });

  const phases = projectStructure?.phases ?? [];
  const activities = projectStructure?.activities ?? [];
  const assignments = projectStructure?.assignments ?? [];

  const { data: consultants = [] } = useQuery({
    queryKey: ['consultants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('consultants').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as Consultant[];
    },
    enabled: !!projectId && !profileLoading,
  });

  const { data: rateOverrides = [] } = useQuery({
    queryKey: ['project_consultant_rates', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_consultant_rates')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []) as ProjectConsultantRate[];
    },
    enabled: !!projectId && !profileLoading,
  });

  const { data: timeEntries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['time_entries_reporting_project', projectId, isWholeOfLife ? 'whole' : monthStartStr, isWholeOfLife ? 'whole' : monthEndStr],
    queryFn: async () => {
      if (!projectId) return [];
      let q = supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', projectId);
      if (!isWholeOfLife) {
        q = q.gte('entry_date', monthStartStr).lte('entry_date', monthEndStr);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!projectId && !profileLoading,
  });

  const consultantMap = useMemo(() => new Map(consultants.map((c) => [c.id, c])), [consultants]);
  const overrideMap = useMemo(
    () => new Map(rateOverrides.map((r) => [r.consultant_id, r.charge_out_rate])),
    [rateOverrides]
  );
  const activityMap = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const getChargeRate = (consultantId: string) => {
    const c = consultantMap.get(consultantId);
    if (!c) return 0;
    return toNum(overrideMap.get(consultantId) ?? c.charge_out_rate);
  };

  const {
    totalHours,
    totalAllocatedHours: _totalAllocatedHours,
    remainingHours,
    totalCost,
    totalBillableAmount,
    totalProfit,
    gpPercent,
    byTask,
    byTeam,
    revenueByMonth,
    hoursByMonthByConsultant,
    consultantListForChart,
  } = useMemo(() => {
    const allocatedByActivity = new Map<string, number>();
    for (const a of activities) {
      const hours = toNum((a as Activity & { estimated_hours?: number }).estimated_hours ?? 0);
      allocatedByActivity.set(a.id, hours);
    }

    let hours = 0;
    let cost = 0;
    let amount = 0;
    const revenueByMonthMap = new Map<string, { revenue: number; cost: number }>();
    const loggedByActivity = new Map<string, number>();
    const taskLoggedMap = new Map<string, { hours: number; cost: number; amount: number; name: string }>();
    const teamMap = new Map<string, { hours: number; cost: number; amount: number; name: string }>();
    const projectNonBillable = Boolean(projectData?.non_billable);

    for (const e of timeEntries) {
      const consultant = consultantMap.get(e.consultant_id);
      const rate = consultant ? toNum(overrideMap.get(e.consultant_id) ?? consultant.charge_out_rate) : 0;
      const costPerHr = consultant != null ? toNum(consultant.cost_per_hour) : 0;
      const hoursRow = toNum(e.hours);
      const rowCost = hoursRow * costPerHr;
      const amt = projectNonBillable ? 0 : hoursRow * rate;
      hours += hoursRow;
      cost += rowCost;
      amount += amt;

      const monthKey = e.entry_date.slice(0, 7); // YYYY-MM
      const bucket = revenueByMonthMap.get(monthKey) ?? { revenue: 0, cost: 0 };
      bucket.revenue += amt;
      bucket.cost += rowCost;
      revenueByMonthMap.set(monthKey, bucket);

      loggedByActivity.set(e.activity_id, (loggedByActivity.get(e.activity_id) ?? 0) + hoursRow);

      const act = activityMap.get(e.activity_id);
      const taskName = act?.name ?? '—';
      if (taskLoggedMap.has(e.activity_id)) {
        const t = taskLoggedMap.get(e.activity_id)!;
        t.hours += hoursRow;
        t.cost += rowCost;
        t.amount += amt;
      } else {
        taskLoggedMap.set(e.activity_id, { hours: hoursRow, cost: rowCost, amount: amt, name: taskName });
      }

      const consultantName = consultant?.name ?? '—';
      if (teamMap.has(e.consultant_id)) {
        const t = teamMap.get(e.consultant_id)!;
        t.hours += hoursRow;
        t.cost += rowCost;
        t.amount += amt;
      } else {
        teamMap.set(e.consultant_id, { hours: hoursRow, cost: rowCost, amount: amt, name: consultantName });
      }
    }

    const phaseMap = new Map(phases.map((p) => [p.id, p]));
    const activitiesSorted = [...activities].sort((a, b) => {
      const phaseA = phaseMap.get(a.phase_id);
      const phaseB = phaseMap.get(b.phase_id);
      const orderA = phaseA?.sort_order ?? 0;
      const orderB = phaseB?.sort_order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

    const byTask = activitiesSorted.map((act) => {
      const phase = phaseMap.get(act.phase_id);
      const allocated = toNum(allocatedByActivity.get(act.id) ?? 0);
      const logged = toNum(loggedByActivity.get(act.id) ?? 0);
      const residual = allocated - logged;
      const loggedData = taskLoggedMap.get(act.id);
      const taskHours = toNum(loggedData?.hours ?? 0);
      const taskCost = toNum(loggedData?.cost ?? 0);
      const taskAmount = toNum(loggedData?.amount ?? 0);
      const profit = taskAmount - taskCost;
      const gp = taskAmount > 0 ? (profit / taskAmount) * 100 : 0;
      return {
        activityId: act.id,
        phaseName: phase?.name ?? '—',
        name: act.name ?? '—',
        allocated,
        logged,
        residual,
        hours: taskHours,
        cost: taskCost,
        amount: taskAmount,
        profit,
        gp: toNum(gp),
      };
    });

    // Monthly: only show tasks that have hours logged in the current (month-filtered) dataset.
    // Whole of life: show all tasks for the project.
    const filteredByTask = isWholeOfLife ? byTask : byTask.filter((row) => row.logged > 0);

    const profit = amount - cost;
    const gp = amount > 0 ? (profit / amount) * 100 : 0;
    const byTeam = Array.from(teamMap.entries()).map(([id, v]) => ({ consultantId: id, ...v }));

    const totalAllocatedHours = Array.from(allocatedByActivity.values()).reduce(
      (sum, v) => sum + toNum(v),
      0
    );
    const remainingHours = totalAllocatedHours - hours;

    const revenueByMonth = Array.from(revenueByMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([monthKey, v]) => {
        const [y, m] = monthKey.split('-').map(Number);
        const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('en-GB', {
          month: 'short',
          year: 'numeric',
        });
        const revenue = v.revenue;
        const costVal = v.cost;
        const margin = Math.max(revenue - costVal, 0);
        return {
          month: monthKey,
          label,
          revenue,
          cost: costVal,
          margin,
        };
      });

    // Hours per month by consultant (for non-admin whole-of-life chart)
    const hoursByMonthMap = new Map<string, Map<string, number>>();
    const consultantIdsInTime = new Set<string>();
    for (const e of timeEntries) {
      const monthKey = e.entry_date.slice(0, 7);
      if (!hoursByMonthMap.has(monthKey)) hoursByMonthMap.set(monthKey, new Map());
      const row = hoursByMonthMap.get(monthKey)!;
      row.set(e.consultant_id, (row.get(e.consultant_id) ?? 0) + toNum(e.hours));
      consultantIdsInTime.add(e.consultant_id);
    }
    const consultantListForChart = consultants.filter((c) => consultantIdsInTime.has(c.id));
    const hoursByMonthByConsultant = Array.from(hoursByMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([monthKey, rowMap]) => {
        const [y, m] = monthKey.split('-').map(Number);
        const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('en-GB', {
          month: 'short',
          year: 'numeric',
        });
        const out: Record<string, string | number> = { month: monthKey, label };
        for (const c of consultantListForChart) {
          out[c.id] = rowMap.get(c.id) ?? 0;
        }
        return out;
      });

    return {
      totalHours: toNum(hours),
      totalAllocatedHours: toNum(totalAllocatedHours),
      remainingHours: toNum(remainingHours),
      totalCost: toNum(cost),
      totalBillableAmount: toNum(amount),
      totalProfit: toNum(profit),
      gpPercent: toNum(gp),
      byTask: filteredByTask,
      byTeam,
      revenueByMonth,
      hoursByMonthByConsultant,
      consultantListForChart,
    };
  }, [timeEntries, consultantMap, overrideMap, activityMap, activities, phases, isWholeOfLife, consultants, projectData]);

  const hoursByWeekByConsultant = useMemo(() => {
    if (isWholeOfLife) return { data: [] as Record<string, string | number>[], consultantListForWeekChart: [] as Consultant[] };
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const weekLabels = ['Week 1 (1-7)', 'Week 2 (8-14)', 'Week 3 (15-21)', 'Week 4 (22-28)', 'Week 5 (29-31)'];
    const weekRanges: [number, number][] = [
      [1, 7],
      [8, 14],
      [15, 21],
      [22, 28],
      [29, 31],
    ];
    const map = new Map<string, number>();
    const consultantIds = new Set<string>();
    for (const e of timeEntries) {
      const day = parseInt(e.entry_date.slice(8, 10), 10);
      let weekIndex = 0;
      for (let w = 0; w < weekRanges.length; w++) {
        if (day >= weekRanges[w][0] && day <= Math.min(weekRanges[w][1], daysInMonth)) {
          weekIndex = w;
          break;
        }
      }
      map.set(`${weekIndex}|${e.consultant_id}`, (map.get(`${weekIndex}|${e.consultant_id}`) ?? 0) + toNum(e.hours));
      consultantIds.add(e.consultant_id);
    }
    const consultantListForWeekChart = consultants.filter((c) => consultantIds.has(c.id));
    const data = weekRanges.map((_range, weekIndex) => {
      const row: Record<string, string | number> = { week: weekLabels[weekIndex], weekIndex };
      for (const c of consultantListForWeekChart) {
        row[c.id] = map.get(`${weekIndex}|${c.id}`) ?? 0;
      }
      return row;
    });
    return { data, consultantListForWeekChart };
  }, [timeEntries, month, consultants, isWholeOfLife]);

  const myHoursByWeek = useMemo(() => {
    if (isWholeOfLife || !consultantId) return { data: [] as { week: string; hours: number }[] };
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const weekLabels = ['Week 1 (1-7)', 'Week 2 (8-14)', 'Week 3 (15-21)', 'Week 4 (22-28)', 'Week 5 (29-31)'];
    const weekRanges: [number, number][] = [
      [1, 7],
      [8, 14],
      [15, 21],
      [22, 28],
      [29, 31],
    ];
    const byWeek = [0, 0, 0, 0, 0];
    for (const e of timeEntries) {
      if (e.consultant_id !== consultantId) continue;
      const day = parseInt(e.entry_date.slice(8, 10), 10);
      for (let w = 0; w < weekRanges.length; w++) {
        if (day >= weekRanges[w][0] && day <= Math.min(weekRanges[w][1], daysInMonth)) {
          byWeek[w] += toNum(e.hours);
          break;
        }
      }
    }
    const data = weekRanges.map((range, i) => ({ week: weekLabels[i], hours: byWeek[i] }));
    return { data };
  }, [timeEntries, month, consultantId, isWholeOfLife]);

  const [tab, setTab] = useState(0);

  const showFinancials = isAdmin;
  const nonBillable = Boolean(projectData?.non_billable);
  const showRevenueAndProfit = isAdmin && !nonBillable;

  if (!projectId || !projectData) {
    if (!projectLoading) {
      return (
        <Box sx={{ py: 3 }}>
          <Typography color="text.secondary">Project not found.</Typography>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
        <CircularProgress size={24} />
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }

  if ((projectData as { status?: string }).status === 'proposal') {
    return (
      <Box sx={{ py: 3 }}>
        <Typography color="text.secondary">
          Reporting is only available for active projects. This project is still a proposal.
        </Typography>
      </Box>
    );
  }

  const clientName = (projectData.client as { name?: string })?.name ?? '—';
  const isLoading = entriesLoading || structureLoading;

  return (
    <Box sx={{ maxWidth: 1600 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 0.5 }}>
        {projectData.name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {clientName}
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 0, mt: 2 }}>
        <Tabs
          value={viewMode === 'wholeOfLife' ? 1 : 0}
          onChange={(_, v) => setViewMode(v === 1 ? 'wholeOfLife' : 'monthly')}
          sx={{ px: 2, '& .MuiTab-root': { textTransform: 'none' } }}
        >
          <Tab label="View by month" id="view-tab-monthly" />
          <Tab label="Whole of life" id="view-tab-whole" />
        </Tabs>
      </Box>

      {viewMode === 'monthly' && (
        <Box sx={{ mt: 2, mb: 2 }}>
          <TimePeriodNavigator
            label={`This month: ${formatMonthRange(month)}`}
            onPrevious={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            onNext={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            previousAriaLabel="Previous month"
            nextAriaLabel="Next month"
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3, ...(viewMode === 'wholeOfLife' && { mt: 3 }) }}>
        <Card variant="outlined" sx={{ minWidth: 140 }}>
          <CardContent>
            <Typography variant="body2" color="text.secondary">Total hours</Typography>
            <Typography variant="h6">{(toNum(totalHours)).toFixed(2)}</Typography>
          </CardContent>
        </Card>
        {showFinancials && (
          <>
            <Card variant="outlined" sx={{ minWidth: 140 }}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">Cost</Typography>
                <Typography variant="h6">
                  ${(toNum(totalCost)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Typography>
              </CardContent>
            </Card>
            {showRevenueAndProfit && (
              <>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Billable amount</Typography>
                    <Typography variant="h6">
                      ${(toNum(totalBillableAmount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Profit</Typography>
                    <Typography variant="h6" color={totalProfit >= 0 ? 'success.main' : 'error.main'}>
                      ${(toNum(totalProfit)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 140 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">GP %</Typography>
                    <Typography variant="h6" color={gpPercent >= 0 ? 'success.main' : 'error.main'}>
                      {(toNum(gpPercent)).toFixed(1)}%
                    </Typography>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </Box>

      {viewMode === 'monthly' && !isAdmin && consultantId && myHoursByWeek.data.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Your hours by week
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Hours you logged per week in the selected month.
            </Typography>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={myHoursByWeek.data}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [toNum(value ?? 0).toFixed(1), 'Hours']}
                    contentStyle={{
                      borderRadius: theme.shape.borderRadius,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                    cursor={false}
                  />
                  <Bar dataKey="hours" name="Hours" fill={theme.palette.primary.main} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {viewMode === 'monthly' && isAdmin && hoursByWeekByConsultant.data.length > 0 && hoursByWeekByConsultant.consultantListForWeekChart.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Hours by week by consultant
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Hours logged per week in the selected month, by consultant.
            </Typography>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={hoursByWeekByConsultant.data}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [toNum(value ?? 0).toFixed(1), 'Hours']}
                    contentStyle={{
                      borderRadius: theme.shape.borderRadius,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                    cursor={false}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => consultantMap.get(value)?.name ?? value}
                  />
                  {hoursByWeekByConsultant.consultantListForWeekChart.map((c, index) => {
                    const fillColor = (c.color && c.color.trim() !== '') ? c.color : [theme.palette.primary.main, theme.palette.primary.light, theme.palette.secondary.dark, theme.palette.success.main, theme.palette.error.main][index % 5];
                    return (
                      <Bar
                        key={c.id}
                        dataKey={c.id}
                        name={c.name}
                        stackId="hours"
                        fill={fillColor}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {isWholeOfLife && showRevenueAndProfit && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Revenue by month (whole of life)
            </Typography>
            {revenueByMonth.length > 0 ? (
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenueByMonth}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value: number | undefined, name?: string, props?: unknown) => {
                      const payload = (props as { payload?: { revenue?: number; cost?: number } })?.payload;
                      const revenue = toNum(payload?.revenue ?? 0);
                      if (name === 'Cost') {
                        const pct = revenue > 0 ? (toNum(payload?.cost ?? 0) / revenue) * 100 : 0;
                        return [
                          `${Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} (${pct.toFixed(
                            1
                          )}%)`,
                          'Cost',
                        ];
                      }
                      return [
                        Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
                        'Margin',
                      ];
                    }}
                    labelFormatter={(label) => `Month: ${label}`}
                    contentStyle={{
                      borderRadius: theme.shape.borderRadius,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                    cursor={false}
                  />
                  <Bar
                    dataKey="cost"
                    name="Cost"
                    stackId="rev"
                    fill={theme.palette.secondary.dark}
                  />
                  <Bar
                    dataKey="margin"
                    name="Margin"
                    stackId="rev"
                    fill={theme.palette.primary.main}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No time entries for this project yet. Log time in Timesheets to see revenue by month.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {isWholeOfLife && !isAdmin && hoursByMonthByConsultant.length > 0 && consultantListForChart.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Hours per month by consultant (whole of life)
            </Typography>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={hoursByMonthByConsultant}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [toNum(value ?? 0).toFixed(1), 'Hours']}
                    contentStyle={{
                      borderRadius: theme.shape.borderRadius,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                    cursor={false}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) => consultantMap.get(value)?.name ?? value}
                  />
                  {consultantListForChart.map((c, index) => {
                    const fillColor = (c.color && c.color.trim() !== '') ? c.color : [theme.palette.primary.main, theme.palette.primary.light, theme.palette.secondary.dark, theme.palette.success.main, theme.palette.error.main][index % 5];
                    return (
                      <Bar
                        key={c.id}
                        dataKey={c.id}
                        name={c.name}
                        stackId="hours"
                        fill={fillColor}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      <Card sx={{ bgcolor: 'background.paper' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
          <Tab label="Task" id="report-tab-0" />
          <Tab label="Team" id="report-tab-1" />
        </Tabs>
        <CardContent sx={{ pt: 2 }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
              <CircularProgress size={24} />
              <Typography color="text.secondary">Loading…</Typography>
            </Box>
          ) : (
            <>
              {tab === 0 && (
                <Box sx={{ width: 1600, maxWidth: '100%', overflowX: 'auto', pr: 3 }}>
                  <Table
                    size="small"
                    sx={{
                      '& .MuiTableCell-root': { borderColor: 'divider' },
                      '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: 'grey.50', fontWeight: 700 },
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Phase</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                        {!nonBillable && (
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Allocated</TableCell>
                        )}
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Logged</TableCell>
                        {!nonBillable && (
                          <>
                            {isWholeOfLife && (
                              <TableCell align="right" sx={{ fontWeight: 700 }}>Hours left</TableCell>
                            )}
                            {!isWholeOfLife && (
                              <TableCell align="right" sx={{ fontWeight: 700 }}>Remaining hours</TableCell>
                            )}
                          </>
                        )}
                        {showFinancials && (
                          <>
                            <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
                            {showRevenueAndProfit && (
                              <>
                                <TableCell align="right" sx={{ fontWeight: 700 }}>Billable amount</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700 }}>Profit</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 700 }}>GP %</TableCell>
                              </>
                            )}
                          </>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {byTask.map((row, index) => {
                        const allocated = toNum(row.allocated);
                        const logged = toNum(row.logged);
                        const residual = toNum(row.residual);
                        const usedRatio = allocated > 0 ? Math.min(1, logged / allocated) : 0;
                        const usedPct = usedRatio * 100;
                        const isFirstPhaseInGroup = isWholeOfLife && (index === 0 || byTask[index - 1].phaseName !== row.phaseName);
                        return (
                          <TableRow key={row.activityId}>
                            <TableCell sx={isFirstPhaseInGroup ? { fontWeight: 700 } : undefined}>{row.phaseName}</TableCell>
                            <TableCell>{row.name}</TableCell>
                            {!nonBillable && (
                              <TableCell align="right">{allocated.toFixed(2)}</TableCell>
                            )}
                            <TableCell align="right">{logged.toFixed(2)}</TableCell>
                            {!nonBillable && (
                              <>
                                {isWholeOfLife && (
                                  <TableCell
                                    align="right"
                                    sx={{ color: residual < 0 ? 'error.main' : undefined, minWidth: 180 }}
                                  >
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                                      <Typography variant="body2" component="div">
                                        {residual.toFixed(2)}
                                      </Typography>
                                      <Box
                                        sx={{
                                          width: 120,
                                          height: 6,
                                          borderRadius: 999,
                                          bgcolor: 'grey.200',
                                          overflow: 'hidden',
                                        }}
                                      >
                                        <Box
                                          sx={{
                                            width: `${usedPct}%`,
                                            height: '100%',
                                            bgcolor: residual < 0 ? 'error.main' : 'primary.main',
                                            transition: 'width 0.2s ease-out',
                                          }}
                                        />
                                      </Box>
                                    </Box>
                                  </TableCell>
                                )}
                                {!isWholeOfLife && (
                                  <TableCell
                                    align="right"
                                    sx={{ color: residual < 0 ? 'error.main' : undefined }}
                                  >
                                    {residual.toFixed(2)}
                                  </TableCell>
                                )}
                              </>
                            )}
                            {showFinancials && (
                              <>
                                <TableCell align="right">
                                  ${toNum(row.cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </TableCell>
                                {showRevenueAndProfit && (
                                  <>
                                    <TableCell align="right">
                                      ${toNum(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell
                                      align="right"
                                      sx={{ color: toNum(row.profit) >= 0 ? 'success.main' : 'error.main' }}
                                    >
                                      ${toNum(row.profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell
                                      align="right"
                                      sx={{ color: toNum(row.gp) >= 0 ? 'success.main' : 'error.main' }}
                                    >
                                      {toNum(row.gp).toFixed(1)}%
                                    </TableCell>
                                  </>
                                )}
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                      {byTask.length > 0 && (
                        <TableRow sx={{ fontWeight: 700, bgcolor: 'grey.50', '& .MuiTableCell-root': { fontWeight: 700 } }}>
                          <TableCell />
                          <TableCell>Total</TableCell>
                          {!nonBillable && (
                            <TableCell align="right">
                              {byTask.reduce((s, r) => s + toNum(r.allocated), 0).toFixed(2)}
                            </TableCell>
                          )}
                          <TableCell align="right">{toNum(totalHours).toFixed(2)}</TableCell>
                          {!nonBillable && (
                            <>
                              {isWholeOfLife && (
                                <TableCell align="right">
                                  {(
                                    byTask.reduce((s, r) => s + toNum(r.allocated), 0) - toNum(totalHours)
                                  ).toFixed(2)}
                                </TableCell>
                              )}
                              {!isWholeOfLife && (
                                <TableCell align="right" sx={{ color: toNum(remainingHours) < 0 ? 'error.main' : undefined }}>
                                  {toNum(remainingHours).toFixed(2)}
                                </TableCell>
                              )}
                            </>
                          )}
                          {showFinancials && (
                            <>
                              <TableCell align="right">
                                ${toNum(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </TableCell>
                              {showRevenueAndProfit && (
                                <>
                                  <TableCell align="right">
                                    ${toNum(totalBillableAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell
                                    align="right"
                                    sx={{ color: toNum(totalProfit) >= 0 ? 'success.main' : 'error.main' }}
                                  >
                                    ${toNum(totalProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell
                                    align="right"
                                    sx={{ color: toNum(gpPercent) >= 0 ? 'success.main' : 'error.main' }}
                                  >
                                    {toNum(gpPercent).toFixed(1)}%
                                  </TableCell>
                                </>
                              )}
                            </>
                          )}
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {tab === 1 && (
                <Table
                  size="small"
                  sx={{
                    '& .MuiTableCell-root': { borderColor: 'divider' },
                    '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: 'grey.50', fontWeight: 700 },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Hours</TableCell>
                      {showFinancials && (
                        <>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
                          {showRevenueAndProfit && (
                            <>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>Rate</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>Billable amount</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>Profit</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700 }}>GP %</TableCell>
                            </>
                          )}
                        </>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {byTeam.map((row) => {
                      const rate = toNum(getChargeRate(row.consultantId));
                      const hours = toNum(row.hours);
                      const cost = toNum(row.cost);
                      const amount = toNum(row.amount);
                      const profit = amount - cost;
                      const gp = amount > 0 ? (profit / amount) * 100 : 0;
                      return (
                        <TableRow key={row.consultantId}>
                          <TableCell>{row.name ?? '—'}</TableCell>
                          <TableCell align="right">{(toNum(hours)).toFixed(2)}</TableCell>
                          {showFinancials && (
                            <>
                              <TableCell align="right">
                                ${(toNum(cost)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </TableCell>
                              {showRevenueAndProfit && (
                                <>
                                  <TableCell align="right">${(toNum(rate)).toFixed(2)}</TableCell>
                                  <TableCell align="right">
                                    ${(toNum(amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell align="right" sx={{ color: profit >= 0 ? 'success.main' : 'error.main' }}>
                                    ${(toNum(profit)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </TableCell>
                                  <TableCell align="right" sx={{ color: gp >= 0 ? 'success.main' : 'error.main' }}>
                                    {(toNum(gp)).toFixed(1)}%
                                  </TableCell>
                                </>
                              )}
                            </>
                          )}
                        </TableRow>
                      );
                    })}
                    {byTeam.length > 0 && (
                      <TableRow sx={{ fontWeight: 700, bgcolor: 'grey.50', '& .MuiTableCell-root': { fontWeight: 700 } }}>
                        <TableCell>Total</TableCell>
                        <TableCell align="right">{(toNum(totalHours)).toFixed(2)}</TableCell>
                        {showFinancials && (
                          <>
                            <TableCell align="right">
                              ${(toNum(totalCost)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            {showRevenueAndProfit && (
                              <>
                                <TableCell />
                                <TableCell align="right">
                                  ${(toNum(totalBillableAmount)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell align="right" sx={{ color: totalProfit >= 0 ? 'success.main' : 'error.main' }}>
                                  ${(toNum(totalProfit)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell align="right" sx={{ color: gpPercent >= 0 ? 'success.main' : 'error.main' }}>
                                  {(toNum(gpPercent)).toFixed(1)}%
                                </TableCell>
                              </>
                            )}
                          </>
                        )}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </>
          )}

          {!isLoading && tab === 0 && byTask.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 2 }}>
              No tasks for this project.
            </Typography>
          )}
          {!isLoading && tab === 1 && byTeam.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 2 }}>
              No time logged for this project in this month.
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
