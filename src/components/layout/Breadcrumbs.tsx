import { useParams, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { supabase } from '../../lib/supabase';

function useClientName(clientId: string | undefined) {
  const { data } = useQuery({
    queryKey: ['client-name', clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data: d, error } = await supabase.from('clients').select('name').eq('id', clientId).single();
      if (error || !d) return null;
      return d.name as string;
    },
    enabled: !!clientId,
  });
  return data ?? null;
}

/**
 * Back button that takes the user back one step in the nav.
 * Only shown when there is a parent route (not on top-level pages).
 */
export function Breadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clientId } = useParams<{ clientId?: string; projectId?: string }>();
  const clientName = useClientName(clientId);
  const clientIdFromQuery = searchParams.get('client');
  const clientNameFromQuery = useClientName(clientIdFromQuery ?? undefined);

  const pathnames = location.pathname.split('/').filter(Boolean);

  // Reporting project: back to Reporting (preserve month and client if we came from client view)
  if (pathnames[0] === 'reporting' && pathnames[1] === 'project') {
    const month = searchParams.get('month');
    const backUrl = month
      ? `/reporting?month=${month}${clientIdFromQuery ? `&client=${clientIdFromQuery}` : ''}`
      : '/reporting';
    const backLabel = clientIdFromQuery && clientNameFromQuery
      ? `Back to ${clientNameFromQuery}`
      : 'Back to Reporting';
    return (
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(backUrl)}
        sx={{ mb: 2, color: 'primary.main', textTransform: 'none', fontWeight: 500 }}
      >
        {backLabel}
      </Button>
    );
  }

  // Client detail (no project in path): back to Projects
  if (pathnames[0] === 'clients' && pathnames[1] && !pathnames[2]) {
    return (
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/')}
        sx={{ mb: 2, color: 'primary.main', textTransform: 'none', fontWeight: 500 }}
      >
        Back to Projects
      </Button>
    );
  }

  // Project detail or new project: back to client
  if (pathnames[0] === 'clients' && pathnames[1] && pathnames[2]) {
    const label = clientName ? `Back to ${clientName}` : 'Back to client';
    return (
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(`/clients/${pathnames[1]}`)}
        sx={{ mb: 2, color: 'primary.main', textTransform: 'none', fontWeight: 500 }}
      >
        {label}
      </Button>
    );
  }

  return null;
}
