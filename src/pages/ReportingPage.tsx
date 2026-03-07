import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@mui/material/styles';
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
  CircularProgress,
  Link,
  IconButton,
} from '@mui/material';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { supabase } from '../lib/supabase';
import { TimePeriodNavigator } from '../components/TimePeriodNavigator';
import { useAuth } from '../contexts/AuthContext';
import type { TimeEntry } from '../types/database';
import type { Consultant, ProjectConsultantRate } from '../types/database';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';

function getMonthStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
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

function formatMonthLabel(d: Date): string {
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

interface ProjectRow {
  id: string;
  name: string;
  client_id: string;
  client?: { id: string; name: string } | null;
  non_billable?: boolean;
}

interface PhaseRow {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

interface ActivityRow {
  id: string;
  phase_id: string;
  name: string;
  sort_order: number;
  estimated_hours?: number;
}

interface AssignmentRow {
  activity_id: string;
  hours: number;
}

interface ProjectSummaryRow {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  allocatedHours: number;
  loggedHours: number;
  remainingHours: number;
  cost: number;
  billableAmount: number;
  nonBillable: boolean;
}

export function ReportingPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchParams] = useSearchParams();
  const clientIdFilter = searchParams.get('client') ?? null;
  const { isAdmin, profileLoading, user, consultantId } = useAuth();
  const monthParam = searchParams.get('month'); // YYYY-MM
  const [month, setMonth] = useState(() => {
    if (monthParam) {
      const [y, m] = monthParam.split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) return new Date(y, m - 1, 1);
    }
    return getMonthStart(new Date());
  });

  useEffect(() => {
    if (monthParam) {
      const [y, m] = monthParam.split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        const d = new Date(y, m - 1, 1);
        setMonth(d);
      }
    }
  }, [monthParam]);

  const monthStartStr = toDateString(getMonthStart(month));
  const monthEndStr = toDateString(getMonthEnd(month));

  const { data: timeEntries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['time_entries_reporting', monthStartStr, monthEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .gte('entry_date', monthStartStr)
        .lte('entry_date', monthEndStr);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !profileLoading,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['reporting-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, client_id, non_billable, client:clients(id, name)')
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as ProjectRow[];
    },
    enabled: !profileLoading,
  });

  const { data: consultants = [] } = useQuery({
    queryKey: ['consultants', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('consultants').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as Consultant[];
    },
    enabled: !profileLoading,
  });

  const { data: rateOverrides = [] } = useQuery({
    queryKey: ['project_consultant_rates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('project_consultant_rates').select('*');
      if (error) throw error;
      return (data ?? []) as ProjectConsultantRate[];
    },
    enabled: !profileLoading,
  });

  const allProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const { data: taskStructure = { phases: [], activities: [], assignments: [] } } = useQuery({
    queryKey: ['reporting-task-structure', allProjectIds],
    queryFn: async () => {
      if (allProjectIds.length === 0)
        return { phases: [] as PhaseRow[], activities: [] as ActivityRow[], assignments: [] as AssignmentRow[] };
      const { data: phases, error: e1 } = await supabase
        .from('phases')
        .select('id, project_id, name, sort_order')
        .in('project_id', allProjectIds)
        .order('sort_order');
      if (e1) throw e1;
      const phaseList = (phases ?? []) as PhaseRow[];
      const phaseIds = phaseList.map((p) => p.id);
      if (phaseIds.length === 0)
        return { phases: phaseList, activities: [] as ActivityRow[], assignments: [] as AssignmentRow[] };
      const { data: activities, error: e2 } = await supabase
        .from('activities')
        .select('id, phase_id, name, sort_order, estimated_hours')
        .in('phase_id', phaseIds)
        .order('sort_order');
      if (e2) throw e2;
      const activityList = (activities ?? []) as ActivityRow[];
      const activityIds = activityList.map((a) => a.id);
      if (activityIds.length === 0)
        return { phases: phaseList, activities: activityList, assignments: [] as AssignmentRow[] };
      const { data: assignments, error: e3 } = await supabase
        .from('activity_assignments')
        .select('activity_id, hours')
        .in('activity_id', activityIds);
      if (e3) throw e3;
      return {
        phases: phaseList,
        activities: activityList,
        assignments: (assignments ?? []) as AssignmentRow[],
      };
    },
    enabled: !profileLoading && allProjectIds.length > 0,
  });

  const consultantMap = useMemo(() => {
    const m = new Map<string, Consultant & { cost_per_hour: number; charge_out_rate: number }>();
    for (const c of consultants) {
      m.set(c.id, {
        ...c,
        cost_per_hour: toNum(c.cost_per_hour),
        charge_out_rate: toNum(c.charge_out_rate),
      });
    }
    return m;
  }, [consultants]);
  const overrideMap = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rateOverrides) {
      if (!m.has(r.project_id)) m.set(r.project_id, new Map());
      m.get(r.project_id)!.set(r.consultant_id, r.charge_out_rate);
    }
    return m;
  }, [rateOverrides]);

  const hoursByWeekByConsultant = useMemo(() => {
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
    const consultantIds = new Set<string>();
    const map = new Map<string, number>();
    for (const e of timeEntries) {
      consultantIds.add(e.consultant_id);
      const day = parseInt(e.entry_date.slice(8, 10), 10);
      let weekIndex = 0;
      for (let w = 0; w < weekRanges.length; w++) {
        if (day >= weekRanges[w][0] && day <= Math.min(weekRanges[w][1], daysInMonth)) {
          weekIndex = w;
          break;
        }
      }
      const key = `${weekIndex}|${e.consultant_id}`;
      map.set(key, (map.get(key) ?? 0) + toNum(e.hours));
    }
    const consultantList = consultants.filter((c) => consultantIds.has(c.id));
    const data = weekRanges.map((_range, weekIndex) => {
      const row: Record<string, string | number> = {
        week: weekLabels[weekIndex],
        weekIndex,
      };
      for (const c of consultantList) {
        row[c.id] = map.get(`${weekIndex}|${c.id}`) ?? 0;
      }
      return row;
    });
    return { data, consultantList };
  }, [timeEntries, consultants, month]);

  const hoursByWeekByProject = useMemo(() => {
    const entriesForConsultant = consultantId
      ? timeEntries.filter((e) => e.consultant_id === consultantId)
      : timeEntries;
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
    const projectIds = new Set<string>();
    const map = new Map<string, number>();
    for (const e of entriesForConsultant) {
      projectIds.add(e.project_id);
      const day = parseInt(e.entry_date.slice(8, 10), 10);
      let weekIndex = 0;
      for (let w = 0; w < weekRanges.length; w++) {
        if (day >= weekRanges[w][0] && day <= Math.min(weekRanges[w][1], daysInMonth)) {
          weekIndex = w;
          break;
        }
      }
      const key = `${weekIndex}|${e.project_id}`;
      map.set(key, (map.get(key) ?? 0) + toNum(e.hours));
    }
    const projectList = projects.filter((p) => projectIds.has(p.id));
    const data = weekRanges.map((_range, weekIndex) => {
      const row: Record<string, string | number> = {
        week: weekLabels[weekIndex],
        weekIndex,
      };
      for (const p of projectList) {
        row[p.id] = map.get(`${weekIndex}|${p.id}`) ?? 0;
      }
      return row;
    });
    return { data, projectList };
  }, [timeEntries, consultantId, month, projects]);

  const revenueCostByWeek = useMemo(() => {
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
    const revenueByWeek: number[] = [0, 0, 0, 0, 0];
    const costByWeek: number[] = [0, 0, 0, 0, 0];
    const projectBillable = new Map(projects.map((p) => [p.id, !p.non_billable]));
    const projectClientId = new Map(projects.map((p) => [p.id, p.client_id]));
    const entriesToUse = clientIdFilter
      ? timeEntries.filter((e) => projectClientId.get(e.project_id) === clientIdFilter)
      : timeEntries;
    for (const e of entriesToUse) {
      const day = parseInt(e.entry_date.slice(8, 10), 10);
      let weekIndex = 0;
      for (let w = 0; w < weekRanges.length; w++) {
        if (day >= weekRanges[w][0] && day <= Math.min(weekRanges[w][1], daysInMonth)) {
          weekIndex = w;
          break;
        }
      }
      const hours = toNum(e.hours);
      const consultant = consultantMap.get(e.consultant_id);
      const rate = consultant
        ? toNum(overrideMap.get(e.project_id)?.get(e.consultant_id) ?? consultant.charge_out_rate)
        : 0;
      const costPerHr = consultant != null ? toNum(consultant.cost_per_hour) : 0;
      if (projectBillable.get(e.project_id)) revenueByWeek[weekIndex] += hours * rate;
      costByWeek[weekIndex] += hours * costPerHr;
    }
    return weekRanges.map((_range, i) => ({
      week: weekLabels[i],
      revenue: Math.round(revenueByWeek[i] * 100) / 100,
      cost: Math.round(costByWeek[i] * 100) / 100,
      margin: Math.round((revenueByWeek[i] - costByWeek[i]) * 100) / 100,
    }));
  }, [timeEntries, consultantMap, overrideMap, month, projects, clientIdFilter]);

  const { summary, byProject } = useMemo(() => {
    let totalHours = 0;
    let totalCost = 0;
    let totalBillableAmount = 0;
    const projectMap = new Map<
      string,
      { hours: number; cost: number; billableAmount: number; clientId: string; clientName: string; projectName: string; nonBillable: boolean }
    >();

    for (const e of timeEntries) {
      const hours = toNum(e.hours);
      const consultant = consultantMap.get(e.consultant_id);
      const rate = consultant
        ? toNum(overrideMap.get(e.project_id)?.get(e.consultant_id) ?? consultant.charge_out_rate)
        : 0;
      const costPerHr = consultant != null ? toNum(consultant.cost_per_hour) : 0;
      const cost = hours * costPerHr;
      const amount = hours * rate;
      totalHours += hours;
      totalCost += cost;
      const proj = projects.find((p) => p.id === e.project_id);
      const nonBillable = Boolean(proj?.non_billable);
      if (!nonBillable) totalBillableAmount += amount;

      const cur = projectMap.get(e.project_id);
      const projForName = projects.find((p) => p.id === e.project_id);
      const clientId = projForName?.client_id ?? '';
      const clientName = (projForName?.client as { name?: string })?.name ?? '—';
      const projectName = projForName?.name ?? '—';
      if (cur) {
        cur.hours += hours;
        cur.cost += cost;
        if (!cur.nonBillable) cur.billableAmount += amount;
      } else {
        projectMap.set(e.project_id, {
          hours,
          cost,
          billableAmount: nonBillable ? 0 : amount,
          clientId,
          clientName,
          projectName,
          nonBillable,
        });
      }
    }

    const { phases, activities } = taskStructure;
    const phaseMap = new Map(phases.map((p) => [p.id, p]));
    const activityToProject = new Map<string, string>();
    for (const a of activities) {
      const phase = phaseMap.get(a.phase_id);
      if (phase) activityToProject.set(a.id, phase.project_id);
    }
    const allocatedByProject = new Map<string, number>();
    for (const a of activities) {
      const projectId = activityToProject.get(a.id);
      if (projectId) {
        const h = toNum(a.estimated_hours ?? 0);
        allocatedByProject.set(projectId, (allocatedByProject.get(projectId) ?? 0) + h);
      }
    }

    const byProject: ProjectSummaryRow[] = Array.from(projectMap.entries())
      .map(([projectId, v]) => {
        const allocated = toNum(allocatedByProject.get(projectId) ?? 0);
        const logged = toNum(v.hours);
        return {
          projectId,
          projectName: v.projectName,
          clientId: v.clientId,
          clientName: v.clientName,
          allocatedHours: allocated,
          loggedHours: logged,
          remainingHours: allocated - logged,
          cost: toNum(v.cost),
          billableAmount: toNum(v.billableAmount),
          nonBillable: v.nonBillable,
        };
      })
      .sort((a, b) => a.projectName.localeCompare(b.projectName));

    const totalProfit = totalBillableAmount - totalCost;
    const gpPercent = totalBillableAmount > 0 ? (totalProfit / totalBillableAmount) * 100 : 0;

    return {
      summary: {
        totalHours: toNum(totalHours),
        totalCost: toNum(totalCost),
        totalBillableAmount: toNum(totalBillableAmount),
        totalProfit: toNum(totalProfit),
        gpPercent: toNum(gpPercent),
      },
      byProject,
    };
  }, [timeEntries, consultantMap, overrideMap, projects, taskStructure]);

  const filteredByProject = useMemo(() => {
    if (!clientIdFilter) return byProject;
    return byProject.filter((row) => row.clientId === clientIdFilter);
  }, [byProject, clientIdFilter]);

  const summaryForDisplay = useMemo(() => {
    if (!clientIdFilter) return summary;
    const totalHours = filteredByProject.reduce((s, r) => s + toNum(r.loggedHours), 0);
    const totalCost = filteredByProject.reduce((s, r) => s + toNum(r.cost), 0);
    const totalBillableAmount = filteredByProject.reduce((s, r) => s + toNum(r.billableAmount), 0);
    const totalProfit = totalBillableAmount - totalCost;
    const gpPercent = totalBillableAmount > 0 ? (totalProfit / totalBillableAmount) * 100 : 0;
    return {
      totalHours,
      totalCost,
      totalBillableAmount,
      totalProfit,
      gpPercent,
    };
  }, [clientIdFilter, filteredByProject, summary]);

  const filteredClientName = useMemo(() => {
    if (!clientIdFilter || filteredByProject.length === 0) return null;
    return filteredByProject[0].clientName;
  }, [clientIdFilter, filteredByProject]);

  const clientDisplayName = useMemo(() => {
    if (clientIdFilter == null) return null;
    if (filteredClientName) return filteredClientName;
    const proj = projects.find((p) => p.client_id === clientIdFilter);
    return (proj?.client as { name?: string } | undefined)?.name ?? 'Client';
  }, [clientIdFilter, filteredClientName, projects]);

  const isLoading = entriesLoading;
  const showFinancials = isAdmin;

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {clientIdFilter != null && (
          <IconButton
            onClick={() => navigate(`/reporting?month=${monthStartStr.slice(0, 7)}`)}
            aria-label="Back to all clients"
            size="small"
            sx={{ mr: 0.5 }}
          >
            <ArrowBack />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>
          {clientDisplayName != null ? clientDisplayName : 'Reporting'}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        View time and billable amounts by month. Click a project to see task and team breakdown.
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 3 }}>
        <TimePeriodNavigator
          label={`This month: ${formatMonthLabel(month)}`}
          onPrevious={() => {
            const d = new Date(month.getFullYear(), month.getMonth() - 1, 1);
            setMonth(d);
            const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const q = clientIdFilter ? `month=${monthStr}&client=${clientIdFilter}` : `month=${monthStr}`;
            navigate(`/reporting?${q}`, { replace: true });
          }}
          onNext={() => {
            const d = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            setMonth(d);
            const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const q = clientIdFilter ? `month=${monthStr}&client=${clientIdFilter}` : `month=${monthStr}`;
            navigate(`/reporting?${q}`, { replace: true });
          }}
          previousAriaLabel="Previous month"
          nextAriaLabel="Next month"
        />
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading…</Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3 }}>
            <Card variant="outlined" sx={{ minWidth: 160 }}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">Total hours</Typography>
                <Typography variant="h6">{toNum(summaryForDisplay.totalHours).toFixed(2)}</Typography>
              </CardContent>
            </Card>
            {showFinancials && (
              <>
                <Card variant="outlined" sx={{ minWidth: 160 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Billable amount</Typography>
                    <Typography variant="h6">
                      ${toNum(summaryForDisplay.totalBillableAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 160 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Cost</Typography>
                    <Typography variant="h6">
                      ${toNum(summaryForDisplay.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 160 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">Profit</Typography>
                    <Typography variant="h6" color={toNum(summaryForDisplay.totalProfit) >= 0 ? 'success.main' : 'error.main'}>
                      ${toNum(summaryForDisplay.totalProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined" sx={{ minWidth: 160 }}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">GP %</Typography>
                    <Typography variant="h6" color={toNum(summaryForDisplay.gpPercent) >= 0 ? 'success.main' : 'error.main'}>
                      {toNum(summaryForDisplay.gpPercent).toFixed(1)}%
                    </Typography>
                  </CardContent>
                </Card>
              </>
            )}
          </Box>

          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              {showFinancials ? (
                <>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                    Revenue and cost by week
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Revenue per week with cost shown as the shaded portion. The unshaded area is margin.
                  </Typography>
                  {revenueCostByWeek.every((d) => d.revenue === 0 && d.cost === 0) ? (
                    <Typography variant="body2" color="text.secondary">
                      No time logged in this month.
                    </Typography>
                  ) : (
                    <Box sx={{ height: 280 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={revenueCostByWeek}
                          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                          stackOffset="none"
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                          <XAxis
                            dataKey="week"
                            tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                            tickFormatter={(v) => `$${v}`}
                          />
                          <Tooltip
                            formatter={(value: number | undefined, name?: string) => [
                              `$${Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                              name === 'cost' ? 'Cost' : name === 'margin' ? 'Margin' : name ?? '',
                            ]}
                            contentStyle={{
                              borderRadius: theme.shape.borderRadius,
                              border: `1px solid ${theme.palette.divider}`,
                            }}
                            labelFormatter={(label) => label}
                            cursor={false}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: 11 }}
                            formatter={(value) => (value === 'cost' ? 'Cost' : value === 'margin' ? 'Margin' : value)}
                          />
                          <Area
                            type="monotone"
                            dataKey="cost"
                            name="cost"
                            stackId="1"
                            stroke={theme.palette.secondary.dark}
                            fill={theme.palette.secondary.light}
                            fillOpacity={0.8}
                          />
                          <Area
                            type="monotone"
                            dataKey="margin"
                            name="margin"
                            stackId="1"
                            stroke={theme.palette.success.main}
                            fill={theme.palette.success.light}
                            fillOpacity={0.8}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Box>
                  )}
                </>
              ) : (
                <>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                    {consultantId ? 'Your time by project' : 'Time logged by consultant'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {consultantId
                      ? 'Hours per week in the selected month, by project you logged time to.'
                      : 'Hours per week in the selected month.'}
                  </Typography>
                  {consultantId ? (
                    hoursByWeekByProject.data.length === 0 || hoursByWeekByProject.projectList.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No time logged in this month.
                      </Typography>
                    ) : (
                      <Box sx={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={hoursByWeekByProject.data}
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
                              formatter={(value: number | undefined) => [Number(value ?? 0).toFixed(1), 'Hours']}
                              contentStyle={{
                                borderRadius: theme.shape.borderRadius,
                                border: `1px solid ${theme.palette.divider}`,
                              }}
                              cursor={false}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11 }}
                              formatter={(value) => projects.find((p) => p.id === value)?.name ?? value}
                            />
                            {hoursByWeekByProject.projectList.map((p, index) => {
                              const strokeColor = [theme.palette.primary.main, theme.palette.primary.light, theme.palette.secondary.dark, theme.palette.success.main, theme.palette.error.main][index % 5];
                              return (
                                <Line
                                  key={p.id}
                                  type="monotone"
                                  dataKey={p.id}
                                  name={p.name}
                                  stroke={strokeColor}
                                  strokeWidth={2}
                                  dot={{ r: 4 }}
                                  connectNulls
                                />
                              );
                            })}
                          </LineChart>
                        </ResponsiveContainer>
                      </Box>
                    )
                  ) : hoursByWeekByConsultant.data.length === 0 || hoursByWeekByConsultant.consultantList.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No time logged in this month.
                    </Typography>
                  ) : (
                    <Box sx={{ height: 280 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
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
                            formatter={(value: number | undefined) => [Number(value ?? 0).toFixed(1), 'Hours']}
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
                          {hoursByWeekByConsultant.consultantList.map((c, index) => {
                            const strokeColor = (c.color && c.color.trim() !== '') ? c.color : [theme.palette.primary.main, theme.palette.primary.light, theme.palette.secondary.dark, theme.palette.success.main, theme.palette.error.main][index % 5];
                            return (
                              <Line
                                key={c.id}
                                type="monotone"
                                dataKey={c.id}
                                name={c.name}
                                stroke={strokeColor}
                                strokeWidth={2}
                                dot={{ r: 4 }}
                                connectNulls
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card sx={{ bgcolor: 'background.paper' }}>
            <CardContent sx={{ p: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 2, pb: 1 }}>
                Project summary
              </Typography>
              {filteredByProject.length === 0 ? (
                <Box sx={{ px: 2, pb: 2 }}>
                  <Typography color="text.secondary">
                    No time logged in this month. Log time in Timesheets to see projects here.
                  </Typography>
                </Box>
              ) : (
                <Table
                  size="small"
                  sx={{
                    '& .MuiTableCell-root': { borderColor: 'divider' },
                    '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: 'grey.50', fontWeight: 700 },
                    '& .MuiTableRow-root:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Client</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Logged Hours</TableCell>
                      {showFinancials && (
                        <>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Billable</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Profit</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>GP</TableCell>
                        </>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredByProject.map((row) => {
                        const profit = toNum(row.billableAmount) - toNum(row.cost);
                        const gp =
                          toNum(row.billableAmount) > 0
                            ? (profit / toNum(row.billableAmount)) * 100
                            : 0;
                        return (
                          <TableRow
                            key={row.projectId}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => {
                              const monthQ = monthStartStr.slice(0, 7);
                              const clientQ = clientIdFilter ? `&client=${clientIdFilter}` : '';
                              navigate(`/reporting/project/${row.projectId}?month=${monthQ}${clientQ}`);
                            }}
                          >
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                {row.remainingHours < 0 && !row.nonBillable && (
                                  <WarningAmber
                                    fontSize="small"
                                    sx={{ color: 'warning.main', flexShrink: 0 }}
                                    aria-label="Over allocated"
                                  />
                                )}
                                <Link
                                component="button"
                                variant="body2"
                                fontWeight={600}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const monthQ = monthStartStr.slice(0, 7);
                                  const clientQ = clientIdFilter ? `&client=${clientIdFilter}` : '';
                                  navigate(`/reporting/project/${row.projectId}?month=${monthQ}${clientQ}`);
                                }}
                                sx={{ textAlign: 'left' }}
                              >
                                {row.projectName}
                              </Link>
                            </Box>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {row.clientId ? (
                                <Link
                                  component="button"
                                  variant="body2"
                                  onClick={() =>
                                    navigate(
                                      `/reporting?month=${monthStartStr.slice(0, 7)}&client=${row.clientId}`
                                    )
                                  }
                                  sx={{ textAlign: 'left' }}
                                >
                                  {row.clientName}
                                </Link>
                              ) : (
                                row.clientName
                              )}
                            </TableCell>
                            <TableCell align="right">
                              {toNum(row.loggedHours).toFixed(1)}
                            </TableCell>
                            {showFinancials && (
                              <>
                                <TableCell align="right">
                                  {row.nonBillable ? '—' : `$${toNum(row.billableAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                                </TableCell>
                                <TableCell align="right">
                                  $
                                  {toNum(row.cost).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    color: row.nonBillable ? undefined : profit >= 0 ? 'success.main' : 'error.main',
                                  }}
                                >
                                  {row.nonBillable ? '—' : `$${toNum(profit).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    color: row.nonBillable ? undefined : toNum(gp) >= 0 ? 'success.main' : 'error.main',
                                  }}
                                >
                                  {row.nonBillable ? '—' : `${toNum(gp).toFixed(1)}%`}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                    })}
                    {filteredByProject.length > 0 && (
                      <TableRow sx={{ fontWeight: 700, bgcolor: 'grey.50', '& .MuiTableCell-root': { fontWeight: 700 } }}>
                        <TableCell />
                        <TableCell>Total</TableCell>
                        <TableCell align="right">
                          {toNum(summaryForDisplay.totalHours).toFixed(1)}
                        </TableCell>
                        {showFinancials && (
                          <>
                            <TableCell align="right">
                              ${toNum(summaryForDisplay.totalBillableAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell align="right">
                              ${toNum(summaryForDisplay.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: toNum(summaryForDisplay.totalProfit) >= 0 ? 'success.main' : 'error.main' }}
                            >
                              ${toNum(summaryForDisplay.totalProfit).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: toNum(summaryForDisplay.gpPercent) >= 0 ? 'success.main' : 'error.main' }}
                            >
                              {toNum(summaryForDisplay.gpPercent).toFixed(1)}%
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}
