import { formatCurrency, getDisplayRateAndRowBudget } from './calculations';

export type TaskRowForCopy = {
  phaseName: string;
  activityName: string;
  estimatedHours: number;
  defaultRate?: number | null;
};

/**
 * Build Phase / Activity / Cost (budget) copy content for the project task list.
 * Used for "Copy" to clipboard (plain text and HTML for Word).
 */
export function buildTaskListCopyContent(
  rows: TaskRowForCopy[]
): { plain: string; html: string } {
  const headers = ['Phase', 'Activity', 'Cost'];
  const headerRow = '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
  const dataRows = rows
    .map((task) => {
      const { rowBudget } = getDisplayRateAndRowBudget(task.estimatedHours, task.defaultRate);
      const costText = rowBudget > 0 ? formatCurrency(rowBudget) : '—';
      return `<tr><td>${escapeHtml(task.phaseName)}</td><td>${escapeHtml(task.activityName)}</td><td>${costText}</td></tr>`;
    })
    .join('');
  const html = `<table border="1" cellpadding="4" cellspacing="0"><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>`;
  const plainRows = rows.map((task) => {
    const { rowBudget } = getDisplayRateAndRowBudget(task.estimatedHours, task.defaultRate);
    const costText = rowBudget > 0 ? formatCurrency(rowBudget) : '—';
    return [task.phaseName, task.activityName, costText].join('\t');
  });
  const plain = [headers.join('\t'), ...plainRows].join('\n');
  return { plain, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
