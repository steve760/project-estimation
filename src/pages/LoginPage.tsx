import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'At least 6 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    try {
      await signIn(data.email, data.password);
      navigate('/');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <img src="/logo.png" alt="Purple Shirt" style={{ maxHeight: 56, width: 'auto' }} />
          </Box>
          <Typography variant="h6" gutterBottom fontWeight={600} sx={{ textAlign: 'center', mb: 2, fontSize: '1rem' }}>
            Project cost estimation
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <form onSubmit={handleSubmit(onSubmit)}>
            <TextField
              {...register('email')}
              label="Email"
              type="email"
              fullWidth
              error={!!errors.email}
              helperText={errors.email?.message}
              sx={{ mb: 2 }}
            />
            <TextField
              {...register('password')}
              label="Password"
              type="password"
              fullWidth
              error={!!errors.password}
              helperText={errors.password?.message}
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={isSubmitting}
              sx={{ mb: 1 }}
            >
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
