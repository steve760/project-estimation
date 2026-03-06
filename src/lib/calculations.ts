import type { Consultant } from '../types/database';
import type { FinancialSummary } from '../types/database';

/** Revenue uses consultant.charge_out_rate or overrideRate when provided. */
export function computeAssignmentCost(
  hours: number,
  consultant: Pick<Consultant, 'cost_per_hour'>
): number {
  return hours * consultant.cost_per_hour;
}

export function computeAssignmentRevenue(
  hours: number,
  consultant: Pick<Consultant, 'charge_out_rate'>,
  overrideRate?: number | null
): number {
  const rate = overrideRate != null ? overrideRate : consultant.charge_out_rate;
  return hours * rate;
}

export function computeFinancialSummary(
  assignments: Array<{ hours: number; consultant: Consultant }>,
  chargeOutOverrides?: Map<string, number> | null
): FinancialSummary {
  let cost = 0;
  let revenue = 0;
  for (const { hours, consultant } of assignments) {
    const costPerHr = Number(consultant.cost_per_hour);
    cost += hours * (Number.isNaN(costPerHr) ? 0 : costPerHr);
    const rate = chargeOutOverrides?.get(consultant.id) ?? consultant.charge_out_rate;
    revenue += hours * (Number(rate) || 0);
  }
  const profit = revenue - cost;
  const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { cost, revenue, profit, marginPercent };
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
