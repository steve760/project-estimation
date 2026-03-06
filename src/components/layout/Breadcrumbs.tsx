import { Link, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Breadcrumbs as MuiBreadcrumbs, Typography } from '@mui/material';
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

function useProjectName(projectId: string | undefined) {
  const { data } = useQuery({
    queryKey: ['project-name', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data: d, error } = await supabase.from('projects').select('name').eq('id', projectId).single();
      if (error || !d) return null;
      return d.name as string;
    },
    enabled: !!projectId,
  });
  return data ?? null;
}

export function Breadcrumbs() {
  const location = useLocation();
  const { clientId, projectId } = useParams<{ clientId?: string; projectId?: string }>();
  const clientName = useClientName(clientId);
  const projectName = useProjectName(projectId);

  const pathnames = location.pathname.split('/').filter(Boolean);

  if (pathnames.length === 0) {
    return (
      <MuiBreadcrumbs sx={{ mb: 2 }}>
        <Typography color="text.primary" fontWeight={600}>Clients</Typography>
      </MuiBreadcrumbs>
    );
  }

  const segments: { label: string; path: string }[] = [
    { label: 'Home', path: '/' },
  ];

  if (clientId && clientName) {
    segments.push({ label: clientName, path: `/clients/${clientId}` });
  } else if (clientId) {
    segments.push({ label: 'Client', path: `/clients/${clientId}` });
  }

  const isNewProject = location.pathname.endsWith('/projects/new');
  if (projectId && projectName) {
    segments.push({ label: projectName, path: `/clients/${clientId}/projects/${projectId}` });
  } else if (isNewProject) {
    segments.push({ label: 'New project', path: `/clients/${clientId}/projects/new` });
  }

  return (
    <MuiBreadcrumbs sx={{ mb: 2 }}>
      {segments.map((seg, i) =>
        i === segments.length - 1 ? (
          <Typography key={seg.path} color="text.primary" fontWeight={600}>
            {seg.label}
          </Typography>
        ) : (
          <Link key={seg.path} to={seg.path} style={{ color: 'inherit', textDecoration: 'none' }}>
            {seg.label}
          </Link>
        )
      )}
    </MuiBreadcrumbs>
  );
}
