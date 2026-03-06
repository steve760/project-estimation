import { ThemeProvider, CssBaseline, CircularProgress, Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { theme } from './theme/theme';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ConsultantsPage } from './pages/ConsultantsPage';
import { TimesheetsPage } from './pages/TimesheetsPage';
import { ReportingPage } from './pages/ReportingPage';
import { ReportingProjectPage } from './pages/ReportingProjectPage';

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!isAdmin) return <Navigate to="/timesheets" replace />;
  return <>{children}</>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60 * 1000, retry: 1 },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress size={48} sx={{ color: 'primary.main' }} />
      </Box>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={(
          <AdminOnlyRoute>
            <ClientsPage />
          </AdminOnlyRoute>
        )} />
        <Route path="clients" element={<Navigate to="/" replace />} />
        <Route path="clients/:clientId" element={<AdminOnlyRoute><ClientDetailPage /></AdminOnlyRoute>} />
        <Route path="clients/:clientId/projects/new" element={<Navigate to=".." replace />} />
        <Route path="clients/:clientId/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="consultants" element={<AdminOnlyRoute><ConsultantsPage /></AdminOnlyRoute>} />
        <Route path="timesheets" element={<TimesheetsPage />} />
        <Route path="reporting" element={<ReportingPage />} />
        <Route path="reporting/project/:projectId" element={<ReportingProjectPage />} />
        <Route path="admin" element={<Navigate to="/consultants" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
