import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface AuthUser {
  id: string;
  email: string | null;
}

interface ConsultantRow {
  id: string;
  name: string;
  user_id: string | null;
  role: string | null;
}

export function AdminLinkUsersPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: consultants = [], isLoading: consultantsLoading } = useQuery({
    queryKey: ['consultants-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultants')
        .select('id, name, user_id, role')
        .order('name');
      if (error) throw error;
      return (data ?? []) as ConsultantRow[];
    },
  });

  const { data: authUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['auth-users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_auth_users');
      if (error) throw error;
      return (data ?? []) as AuthUser[];
    },
    enabled: isAdmin,
  });

  const linkMutation = useMutation({
    mutationFn: async ({ consultantId, userId }: { consultantId: string; userId: string | null }) => {
      const { error } = await supabase.rpc('link_consultant_to_user', {
        p_consultant_id: consultantId,
        p_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultants-admin'] });
      queryClient.invalidateQueries({ queryKey: ['auth-users'] });
    },
  });

  if (!isAdmin) {
    return (
      <Box sx={{ py: 3 }}>
        <Alert severity="warning">You need admin access to view this page.</Alert>
      </Box>
    );
  }

  const isLoading = consultantsLoading || usersLoading;

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
        Link users to consultants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Assign each consultant to a login account. The linked user can sign in and will see timesheets and data for that consultant.
      </Typography>

      {isLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading…</Typography>
        </Box>
      ) : (
        <Card variant="outlined">
          <CardContent sx={{ p: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Consultant</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Linked user</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {consultants.map((c) => {
                  const currentUserId = c.user_id ?? '';
                  return (
                    <TableRow key={c.id}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>
                        <Typography variant="body2" color={c.role === 'admin' ? 'primary.main' : 'text.secondary'}>
                          {c.role === 'admin' ? 'Admin' : 'User'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <FormControl size="small" sx={{ minWidth: 260 }}>
                          <InputLabel>User</InputLabel>
                          <Select
                            value={currentUserId}
                            label="User"
                            onChange={(e) => {
                              const val = e.target.value as string;
                              const userId = val === '' ? null : val;
                              linkMutation.mutate({ consultantId: c.id, userId });
                            }}
                            disabled={linkMutation.isPending}
                          >
                            <MenuItem value="">
                              <em>Not linked</em>
                            </MenuItem>
                            {authUsers.map((u) => (
                              <MenuItem key={u.id} value={u.id}>
                                {u.email ?? u.id}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {linkMutation.isPending && linkMutation.variables?.consultantId === c.id && (
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            Saving…
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!isLoading && consultants.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No consultants yet. Add consultants on the Consultants page first.
        </Typography>
      )}
    </Box>
  );
}
