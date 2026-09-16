import type { Activity, Funnel, Posting } from './client.js';

export const POSTING_COLUMNS = ['Id', 'Seen', 'Company', 'Title', 'Status', 'Board', 'Key', 'Verdict'] as const;
export const ACTIVITY_COLUMNS = ['Id', 'Date', 'Kind', 'Employer', 'Position', 'Channel', 'Reported', 'Notes'] as const;

/** One cell: null and undefined print empty, pipes are escaped, newlines become spaces. */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

export function renderTable(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const header = `| ${columns.join(' | ')} |`;
  const rule = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(' | ')} |`);
  return [header, rule, ...body].join('\n');
}

export function renderPostings(postings: readonly Posting[]): string {
  return renderTable(
    POSTING_COLUMNS,
    postings.map((p) => [p.id, p.first_seen_on, p.company, p.title, p.status, p.board, p.key, p.verdict]),
  );
}

export function renderActivities(activities: readonly Activity[]): string {
  return renderTable(
    ACTIVITY_COLUMNS,
    activities.map((a) => [a.id, a.performed_on, a.kind, a.employer, a.position, a.channel, a.reported, a.notes]),
  );
}

export function renderFunnel(funnel: Funnel): string {
  return renderTable(
    ['Measure', 'Count'],
    Object.entries(funnel).map(([key, value]) => [key, value]),
  );
}
