import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import {
  Box,
  AppBar,
  Drawer,
  Toolbar,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Link,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  People as PeopleIcon,
  Business as BusinessIcon,
  Schedule as TimesheetsIcon,
  Assessment as ReportingIcon,
  Menu as MenuIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Breadcrumbs } from './Breadcrumbs';

const DRAWER_WIDTH = 260;

const navItems = [
  { path: '/', label: 'Projects', icon: <PeopleIcon />, adminOnly: true },
  { path: '/timesheets', label: 'Timesheets', icon: <TimesheetsIcon />, adminOnly: false },
  { path: '/reporting', label: 'Reporting', icon: <ReportingIcon />, adminOnly: false },
  { path: '/consultants', label: 'Consultants', icon: <BusinessIcon />, adminOnly: true },
];

export function AppLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const allNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  const handleSignOut = () => {
    signOut();
    navigate('/login');
  };

  const drawer = (
    <Box sx={{ py: 2, px: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 1, pb: 2, display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
        <img src="/logo.png" alt="Purple Shirt" style={{ maxHeight: 22, width: 'auto', marginLeft: 12 }} />
      </Box>
      <List disablePadding sx={{ flex: 1 }}>
        {allNavItems.map(({ path, label, icon }) => (
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
      {isMobile && (
        <AppBar
          position="fixed"
          elevation={0}
          color="inherit"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Toolbar sx={{ minHeight: 64, px: 2 }}>
            <IconButton
              edge="start"
              color="inherit"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <img src="/logo.png" alt="Purple Shirt" style={{ maxHeight: 22, width: 'auto' }} />
            </Box>
          </Toolbar>
        </AppBar>
      )}
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
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
          px: 3,
          py: 3,
          pt: isMobile ? 10 : 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
        }}
      >
        <Breadcrumbs />
        <Outlet />
      </Box>
    </Box>
  );
}
