import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { supabase } from '../lib/supabase';

const schema = z.object({ name: z.string().min(1, 'Name is required') });
type Form = z.infer<typeof schema>;

export function NewProjectPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (name: string) => {
      if (!clientId) throw new Error('No client');
      const { data, error } = await supabase
        .from('projects')
        .insert({ client_id: clientId, name })
        .select()
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      navigate(`/clients/${clientId}/projects/${data.id}`);
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  if (!clientId) {
    navigate('/clients');
    return null;
  }

  return (
    <Box>
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>New project</Typography>
          <form onSubmit={handleSubmit((d) => mutation.mutate(d.name))}>
            <TextField
              {...register('name')}
              label="Project name"
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
              sx={{ mb: 2 }}
              autoFocus
            />
            <Button type="submit" variant="contained" disabled={mutation.isPending}>
              Create project
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
