import { describe, it, expect } from 'vitest';
import { buildTaskListCopyContent } from './taskListCopy';

describe('buildTaskListCopyContent', () => {
  it('uses Phase, Activity, Cost headers (no Hours)', () => {
    const { plain, html } = buildTaskListCopyContent([]);
    expect(plain).toBe('Phase\tActivity\tCost');
    expect(html).toContain('<th>Phase</th><th>Activity</th><th>Cost</th>');
    expect(plain).not.toContain('Hours');
    expect(html).not.toContain('Hours');
  });

  it('includes phase name, activity name, and cost (budget) per row', () => {
    const rows = [
      { phaseName: 'P1: Discovery', activityName: 'Workshops', estimatedHours: 10, defaultRate: 200 },
      { phaseName: 'P2: Design', activityName: 'UI', estimatedHours: 20, defaultRate: 150 },
    ];
    const { plain, html } = buildTaskListCopyContent(rows);
    expect(plain).toContain('P1: Discovery');
    expect(plain).toContain('Workshops');
    expect(plain).toContain('P2: Design');
    expect(plain).toContain('UI');
    expect(html).toContain('P1: Discovery');
    expect(html).toContain('Workshops');
    // Cost: 10*200=2000, 20*150=3000 -> $2,000.00 and $3,000.00
    expect(plain).toContain('$2,000.00');
    expect(plain).toContain('$3,000.00');
    expect(html).toContain('$2,000.00');
    expect(html).toContain('$3,000.00');
  });

  it('shows — for cost when budget is zero (no hours or no rate)', () => {
    const rows = [
      { phaseName: 'Phase', activityName: 'Task', estimatedHours: 0, defaultRate: 200 },
      { phaseName: 'Phase', activityName: 'Task2', estimatedHours: 5, defaultRate: null },
    ];
    const { plain, html } = buildTaskListCopyContent(rows);
    // 0 hours -> rowBudget 0 -> —
    // 5 * 0 (null rate) -> 0 -> —
    expect(plain).toContain('—');
    expect(html).toContain('—');
  });

  it('plain text is tab-separated with header row', () => {
    const rows = [
      { phaseName: 'A', activityName: 'B', estimatedHours: 1, defaultRate: 100 },
    ];
    const { plain } = buildTaskListCopyContent(rows);
    const lines = plain.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Phase\tActivity\tCost');
    expect(lines[1]).toContain('A');
    expect(lines[1]).toContain('B');
    expect(lines[1]).toContain('$100.00');
  });
});
