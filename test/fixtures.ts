import type { Activity, Posting } from '../src/client.js';

export const posting = (over: Partial<Posting> = {}): Posting => ({
  id: 1,
  company: 'Watershed',
  title: 'Staff Engineer, Growth',
  url: 'https://example.com/jobs/1',
  key: 'greenhouse,watershed,123',
  board: 'greenhouse',
  track: 'w2',
  status: 'shortlisted',
  closed_reason: null,
  verdict: 'strong fit',
  fit_score: 8,
  first_seen_on: '2026-09-14',
  applied_on: null,
  notes: null,
  created_at: '2026-09-14T12:00:00Z',
  updated_at: '2026-09-14T12:00:00Z',
  ...over,
});

export const activity = (over: Partial<Activity> = {}): Activity => ({
  id: 10,
  performed_on: '2026-09-15',
  kind: 'application',
  employer: 'Watershed',
  position: 'Staff Engineer, Growth',
  url: 'https://example.com/jobs/1',
  job_posting_id: 1,
  channel: 'greenhouse',
  notes: null,
  reported_at: null,
  confirmation: null,
  exclusion_reason: null,
  reported: false,
  created_at: '2026-09-15T12:00:00Z',
  updated_at: '2026-09-15T12:00:00Z',
  ...over,
});

export const page = <T>(collection: T[], meta: { page: number; total_pages: number; total: number }, next: string | null) => ({
  data: { collection },
  meta: { page: meta.page, per_page: collection.length, total: meta.total, total_pages: meta.total_pages },
  links: {
    self: `/v1/work/x?page=${meta.page}`,
    first: '/v1/work/x?page=1',
    prev: meta.page > 1 ? `/v1/work/x?page=${meta.page - 1}` : null,
    next,
    last: `/v1/work/x?page=${meta.total_pages}`,
  },
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
