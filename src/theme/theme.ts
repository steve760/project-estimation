import { createTheme } from '@mui/material/styles';

// Colour palette: Primary (Main Purple, Dark Purple), Secondary (Secondary Purple, Tertiary Purple), Tertiary (Background Purple 22% #B69AF2, Background Grey)
export const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#F2F2F2', // Background Grey
      paper: '#ffffff',
    },
    primary: {
      main: '#6D5CBE', // Main Purple – important titles, primary actions, emphasis
      light: '#B69AF2', // Secondary Purple
      dark: '#19002D', // Dark Purple
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#B69AF2', // Secondary Purple – accent
      light: '#EDEBF9', // Background Purple (22% #B69AF2 tint)
      dark: '#8B88FF', // Tertiary Purple
    },
    success: {
      main: '#10b981',
    },
    error: {
      main: '#ef4444',
    },
    text: {
      primary: '#19002D', // Dark Purple for strong emphasis
      secondary: '#5c5c5c',
    },
  },
  shape: {
    borderRadius: 12,
  },
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,0.04)',
    '0 2px 4px rgba(0,0,0,0.04)',
    '0 4px 8px rgba(0,0,0,0.06)',
    '0 8px 16px rgba(0,0,0,0.06)',
    '0 12px 24px rgba(0,0,0,0.08)',
    '0 16px 32px rgba(0,0,0,0.08)',
    '0 20px 40px rgba(0,0,0,0.08)',
    '0 24px 48px rgba(0,0,0,0.10)',
    '0 28px 56px rgba(0,0,0,0.10)',
    '0 32px 64px rgba(0,0,0,0.10)',
    '0 36px 72px rgba(0,0,0,0.12)',
    '0 40px 80px rgba(0,0,0,0.12)',
    '0 44px 88px rgba(0,0,0,0.12)',
    '0 48px 96px rgba(0,0,0,0.12)',
    '0 52px 104px rgba(0,0,0,0.14)',
    '0 56px 112px rgba(0,0,0,0.14)',
    '0 60px 120px rgba(0,0,0,0.14)',
    '0 64px 128px rgba(0,0,0,0.14)',
    '0 68px 136px rgba(0,0,0,0.16)',
    '0 72px 144px rgba(0,0,0,0.16)',
    '0 76px 152px rgba(0,0,0,0.16)',
    '0 80px 160px rgba(0,0,0,0.16)',
    '0 84px 168px rgba(0,0,0,0.18)',
    '0 88px 176px rgba(0,0,0,0.18)',
  ],
  typography: {
    fontFamily: '"Plus Jakarta Sans", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
      letterSpacing: '-0.02em',
    },
    h5: {
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontWeight: 600,
    },
    subtitle1: {
      fontWeight: 500,
    },
    body1: {
      lineHeight: 1.6,
    },
    body2: {
      lineHeight: 1.5,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 10,
          fontWeight: 600,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(109, 92, 190, 0.25)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          '&:hover': {
            backgroundColor: 'secondary.light',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
          },
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          fontFamily: 'inherit',
          backgroundColor: '#6D5CBE',
          color: '#ffffff',
          fontSize: '0.75em',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'secondary.light',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          verticalAlign: 'middle',
        },
      },
    },
  },
});
