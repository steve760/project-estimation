import { useQuery } from '@tanstack/react-query';
import { Box, Card, CardContent, Typography, Skeleton, Alert } from '@mui/material';
import { TrendingUp, AttachMoney, People, Folder } from '@mui/icons-material';
import { supabase } from '../lib/supabase';
import { computeFinancialSummary } from '../lib/calculations';
import type { ActivityAssignment } from '../types/database';
import type { Consultant } from '../types/database';

async function fetchDashboardData() {
  const [clientsRes, projectsRes, consultantsRes, assignmentsRes] = await Promise.all([
    supabase.from('clients').select('id'),
    supabase.from('projects').select('id'),
    supabase.from('consultants').select('*'),
    supabase.from('activity_assignments').select('id, hours, consultant_id'),
  ]);

  if (clientsRes.error) throw clientsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (consultantsRes.error) throw consultantsRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;

  const consultants = (consultantsRes.data ?? []) as Consultant[];
  const assignments = (assignmentsRes.data ?? []) as (ActivityAssignment & { consultant_id: string })[];
  const consultantMap = new Map(consultants.map((c) => [c.id, c]));

  const assignmentWithConsultant = assignments
    .map((a) => ({
      hours: a.hours,
      consultant: consultantMap.get(a.consultant_id),
    }))
    .filter((a): a is { hours: number; consultant: Consultant } => !!a.consultant);

  const summary = computeFinancialSummary(assignmentWithConsultant);

  return {
    clientCount: (clientsRes.data ?? []).length,
    projectCount: (projectsRes.data ?? []).length,
    consultantCount: consultants.length,
    summary,
  };
}

export function DashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
  });

  if (isLoading) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom fontWeight={600}>Dashboard</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 3 }}>
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" height={40} />
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>
    );
  }

  const summary = data?.summary ?? { cost: 0, revenue: 0, profit: 0, marginPercent: 0 };
  const clientCount = data?.clientCount ?? 0;
  const projectCount = data?.projectCount ?? 0;

  const cards = [
    {
      title: 'Total cost',
      value: `$${summary.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      icon: <AttachMoney sx={{ fontSize: 32, color: 'primary.main' }} />,
    },
    {
      title: 'Total revenue',
      value: `$${summary.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      icon: <TrendingUp sx={{ fontSize: 32, color: 'success.main' }} />,
    },
    {
      title: 'Clients',
      value: clientCount,
      icon: <People sx={{ fontSize: 32, color: 'primary.main' }} />,
    },
    {
      title: 'Projects',
      value: projectCount,
      icon: <Folder sx={{ fontSize: 32, color: 'primary.main' }} />,
    },
  ];

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight={600}>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Overview of costs, revenue, and key metrics across all projects.
      </Typography>

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load dashboard data. {error instanceof Error ? error.message : 'Check your connection and try again.'} Use the sidebar to open Clients or Consultants.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 3, mb: 3 }}>
        {cards.map((card) => (
          <Card key={card.title}>
              <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                {card.icon}
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {card.title}
                  </Typography>
                  <Typography variant="h5" fontWeight={600}>
                    {typeof card.value === 'number' ? card.value : card.value}
                  </Typography>
                </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Profitability summary
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Profit
              </Typography>
              <Typography
                variant="h6"
                color={summary.profit >= 0 ? 'success.main' : 'error.main'}
              >
                ${summary.profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Margin
              </Typography>
              <Typography
                variant="h6"
                color={summary.marginPercent >= 0 ? 'success.main' : 'error.main'}
              >
                {summary.marginPercent.toFixed(1)}%
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
