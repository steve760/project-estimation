import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
            bgcolor: 'background.default',
          }}
        >
          <Typography variant="h6" color="error" sx={{ mb: 1 }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, maxWidth: 480 }}>
            {this.state.error.message}
          </Typography>
          <Button
            variant="contained"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
