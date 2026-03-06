import { Box, Divider, IconButton, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';

export interface TimePeriodNavigatorProps {
  /** Label shown next to the arrows (e.g. "This month: Mar 2026" or "This week: 01 – 05 Mar 2026") */
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  previousAriaLabel?: string;
  nextAriaLabel?: string;
  sx?: object;
}

/**
 * App-wide time period navigation: grouped prev/next chevrons in a single control, with label to the right.
 * Uses consistent controls and font size (body1, fontWeight 600).
 */
export function TimePeriodNavigator({
  label,
  onPrevious,
  onNext,
  previousAriaLabel = 'Previous period',
  nextAriaLabel = 'Next period',
  sx,
}: TimePeriodNavigatorProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, ...sx }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'grey.100',
          overflow: 'hidden',
        }}
      >
        <IconButton
          size="small"
          onClick={onPrevious}
          aria-label={previousAriaLabel}
          sx={{ borderRadius: 0 }}
        >
          <ChevronLeft />
        </IconButton>
        <Divider orientation="vertical" flexItem />
        <IconButton
          size="small"
          onClick={onNext}
          aria-label={nextAriaLabel}
          sx={{ borderRadius: 0 }}
        >
          <ChevronRight />
        </IconButton>
      </Box>
      <Typography variant="body1" fontWeight={600} sx={{ ml: 2 }}>
        {label}
      </Typography>
    </Box>
  );
}
