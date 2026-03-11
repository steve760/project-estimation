import { describe, it, expect } from 'vitest';
import {
  computeAssignmentCost,
  computeAssignmentRevenue,
  computeFinancialSummary,
  formatCurrency,
  getDisplayRateAndRowBudget,
  roundCurrency,
} from './calculations';
import type { Consultant } from '../types/database';

function makeConsultant(overrides: Partial<Consultant> = {}): Consultant {
  return {
    id: 'c1',
    name: 'Test',
    cost_per_hour: 100,
    charge_out_rate: 200,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('formatCurrency', () => {
  it('formats integers with thousands separator', () => {
    expect(formatCurrency(1200)).toBe('$1,200.00');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(1234567)).toBe('$1,234,567.00');
  });

  it('formats decimals to 2 places', () => {
    expect(formatCurrency(99.9)).toBe('$99.90');
    expect(formatCurrency(10.1)).toBe('$10.10');
    expect(formatCurrency(0.5)).toBe('$0.50');
  });

  it('handles negative as formatted number', () => {
    expect(formatCurrency(-500)).toBe('$-500.00');
  });

  it('handles NaN/undefined via Number()', () => {
    expect(formatCurrency(Number(NaN))).toBe('$0.00');
    expect(formatCurrency(undefined as unknown as number)).toBe('$0.00');
  });

  it('output has exactly one leading dollar sign (no double $$)', () => {
    expect(formatCurrency(2134).startsWith('$$')).toBe(false);
    expect(formatCurrency(2134)[0]).toBe('$');
    expect(formatCurrency(2134)).toBe('$2,134.00');
  });

  /** App-wide contract: currency must display as $X,XXX.00 (one $, commas, 2 decimals) */
  it('matches app currency display contract (one $, thousands separators, two decimals)', () => {
    const values = [0, 1, 99.9, 1200, 1234567.89, -100];
    for (const v of values) {
      const out = formatCurrency(v);
      expect(out).toMatch(/^\$-?\d/);
      expect(out).not.toMatch(/\$\$/);
      expect(out).toMatch(/\.\d{2}$/);
    }
  });
});

describe('roundCurrency', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundCurrency(10.556)).toBe(10.56);
    expect(roundCurrency(10.554)).toBe(10.55);
    expect(roundCurrency(0)).toBe(0);
  });

  it('handles negative and large numbers', () => {
    expect(roundCurrency(-10.555)).toBe(-10.55);
    expect(roundCurrency(99999.994)).toBe(99999.99);
  });
});

describe('computeAssignmentCost', () => {
  it('returns hours * cost_per_hour', () => {
    expect(computeAssignmentCost(10, makeConsultant({ cost_per_hour: 50 }))).toBe(500);
    expect(computeAssignmentCost(0, makeConsultant())).toBe(0);
  });
});

describe('computeAssignmentRevenue', () => {
  it('returns hours * charge_out_rate when no override', () => {
    expect(computeAssignmentRevenue(10, makeConsultant({ charge_out_rate: 200 }))).toBe(2000);
  });

  it('uses override rate when provided', () => {
    expect(
      computeAssignmentRevenue(10, makeConsultant({ charge_out_rate: 200 }), 150)
    ).toBe(1500);
  });
});

describe('computeFinancialSummary', () => {
  it('sums cost and revenue across assignments', () => {
    const c1 = makeConsultant({ id: 'c1', cost_per_hour: 100, charge_out_rate: 200 });
    const c2 = makeConsultant({ id: 'c2', cost_per_hour: 50, charge_out_rate: 150 });
    const summary = computeFinancialSummary(
      [
        { hours: 10, consultant: c1 },
        { hours: 20, consultant: c2 },
      ],
      null
    );
    expect(summary.cost).toBe(10 * 100 + 20 * 50); // 1000 + 1000 = 2000
    expect(summary.revenue).toBe(10 * 200 + 20 * 150); // 2000 + 3000 = 5000
    expect(summary.profit).toBe(5000 - 2000); // 3000
    expect(summary.marginPercent).toBe(60); // 3000/5000 * 100
  });

  it('applies charge-out overrides', () => {
    const c = makeConsultant({ id: 'c1', cost_per_hour: 100, charge_out_rate: 200 });
    const overrides = new Map<string, number>([['c1', 250]]);
    const summary = computeFinancialSummary([{ hours: 10, consultant: c }], overrides);
    expect(summary.revenue).toBe(10 * 250);
    expect(summary.cost).toBe(1000);
  });

  it('returns zero margin when revenue is 0', () => {
    const summary = computeFinancialSummary([], null);
    expect(summary.cost).toBe(0);
    expect(summary.revenue).toBe(0);
    expect(summary.profit).toBe(0);
    expect(summary.marginPercent).toBe(0);
  });

  it('profit = revenue - cost (negative when cost exceeds revenue)', () => {
    const c = makeConsultant({ id: 'c1', cost_per_hour: 150, charge_out_rate: 100 });
    const summary = computeFinancialSummary([{ hours: 10, consultant: c }], null);
    expect(summary.cost).toBe(1500);
    expect(summary.revenue).toBe(1000);
    expect(summary.profit).toBe(-500);
    expect(summary.marginPercent).toBe(-50); // -500/1000 * 100
  });

  it('marginPercent is (profit/revenue)*100 when revenue > 0', () => {
    const c1 = makeConsultant({ id: 'c1', cost_per_hour: 80, charge_out_rate: 200 });
    const summary = computeFinancialSummary([{ hours: 100, consultant: c1 }], null);
    expect(summary.revenue).toBe(20000);
    expect(summary.cost).toBe(8000);
    expect(summary.profit).toBe(12000);
    expect(summary.marginPercent).toBe(60);
  });
});

describe('getDisplayRateAndRowBudget', () => {
  it('returns rate and hours*rate when rate is normal', () => {
    expect(getDisplayRateAndRowBudget(10, 200)).toEqual({ displayRate: 200, rowBudget: 2000 });
    expect(getDisplayRateAndRowBudget(0, 200)).toEqual({ displayRate: 200, rowBudget: 0 });
  });

  it('treats large value as row total when quotient is plausible $/hr', () => {
    // 40 hrs, 8000 stored -> interpret as $8000 total, $200/hr
    expect(getDisplayRateAndRowBudget(40, 8000)).toEqual({ displayRate: 200, rowBudget: 8000 });
    expect(getDisplayRateAndRowBudget(64, 12800)).toEqual({ displayRate: 200, rowBudget: 12800 });
  });

  it('does not treat as row total when quotient out of range', () => {
    // 1 hr, 10000 -> 10000/hr is > 5000, so keep as rate
    expect(getDisplayRateAndRowBudget(1, 10000)).toEqual({ displayRate: 10000, rowBudget: 10000 });
  });

  it('handles null/undefined rate', () => {
    expect(getDisplayRateAndRowBudget(10, null)).toEqual({ displayRate: 0, rowBudget: 0 });
    expect(getDisplayRateAndRowBudget(10, undefined)).toEqual({ displayRate: 0, rowBudget: 0 });
  });
});

/** Mirrors reporting screens: totals and profit/gp formulas */
describe('reporting calculations (same as ReportingProjectPage / ReportingPage)', () => {
  it('total cost = sum(hours * cost_per_hour), total revenue = sum(hours * rate), profit = revenue - cost', () => {
    const c1 = makeConsultant({ id: 'a', cost_per_hour: 100, charge_out_rate: 200 });
    const c2 = makeConsultant({ id: 'b', cost_per_hour: 50, charge_out_rate: 150 });
    const summary = computeFinancialSummary(
      [
        { hours: 10, consultant: c1 },
        { hours: 20, consultant: c2 },
      ],
      null
    );
    const expectedCost = 10 * 100 + 20 * 50;
    const expectedRevenue = 10 * 200 + 20 * 150;
    expect(summary.cost).toBe(expectedCost);
    expect(summary.revenue).toBe(expectedRevenue);
    expect(summary.profit).toBe(expectedRevenue - expectedCost);
    expect(summary.marginPercent).toBe(
      summary.revenue > 0 ? (summary.profit / summary.revenue) * 100 : 0
    );
  });

  it('gp percent = (profit / revenue) * 100 when revenue > 0, else 0', () => {
    const c = makeConsultant({ id: 'x', cost_per_hour: 80, charge_out_rate: 200 });
    const summary = computeFinancialSummary([{ hours: 50, consultant: c }], null);
    expect(summary.marginPercent).toBe(((10000 - 4000) / 10000) * 100);
  });
});
