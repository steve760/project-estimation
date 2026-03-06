import { Outlet } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Link,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  People as PeopleIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Breadcrumbs } from './Breadcrumbs';

const DRAWER_WIDTH = 260;

const navItems = [
  { path: '/', label: 'Clients', icon: <PeopleIcon /> },
  { path: '/consultants', label: 'Consultants', icon: <BusinessIcon /> },
];

export function AppLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();

  const handleSignOut = () => {
    signOut();
    navigate('/login');
  };

  const drawer = (
    <Box sx={{ py: 2, px: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography
        variant="h6"
        sx={{ px: 2, mb: 2, fontWeight: 700, color: 'primary.main' }}
      >
        Project Estimation
      </Typography>
      <List disablePadding sx={{ flex: 1 }}>
        {navItems.map(({ path, label, icon }) => (
          <ListItemButton
            key={path}
            selected={location.pathname === path || (path !== '/' && location.pathname.startsWith(path + '/'))}
            onClick={() => navigate(path)}
            sx={{
              borderRadius: 2,
              mx: 1,
              mb: 0.5,
              '& .MuiListItemIcon-root': { color: 'primary.main' },
              '&.Mui-selected': {
                backgroundColor: 'primary.main',
                color: 'white',
                '&:hover': { backgroundColor: 'primary.light', color: 'primary.dark' },
                '& .MuiListItemIcon-root': { color: 'inherit' },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <img src="/logo.png" alt="Purple Shirt" style={{ maxHeight: 48, width: 'auto' }} />
      </Box>
      <Box sx={{ px: 2, py: 2, mt: 'auto', borderTop: 1, borderColor: 'divider' }}>
        <Link
          component="button"
          variant="body2"
          onClick={handleSignOut}
          sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary' } }}
        >
          Sign out
        </Link>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={!isMobile}
        onClose={() => {}}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            top: 0,
            pt: 0,
          },
        }}
      >
        {drawer}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
        }}
      >
        {!location.pathname.match(/^\/clients\/[^/]+$/) && <Breadcrumbs />}
        <Outlet />
      </Box>
    </Box>
  );
}
