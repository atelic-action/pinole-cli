import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { run, type ProgramIo } from '../src/program.js';
import { activity, json, page, posting } from './fixtures.js';

type Handler = (request: Request) => Promise<Response> | Response;

function harness(handler: Handler, over: Partial<ProgramIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const fetch = vi.fn(async (input: Request) => handler(input));
  const io: ProgramIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readStdin: () => '',
    env: { PINOLE_API_TOKEN: 'tok_cli' },
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...over,
  };
  const requests = () => fetch.mock.calls.map((c) => c[0] as Request);
  return { io, out, err, fetch, requests, run: (argv: string[]) => run(argv, io) };
}

describe('pinole work postings list', () => {
  it('passes filters through and prints the raw envelope', async () => {
    const h = harness(() => json(page([posting()], { page: 1, total_pages: 1, total: 1 }, null)));
    const code = await h.run(['work', 'postings', 'list', '--status', 'queued,applied', '--track', 'w2', '--board', 'greenhouse', '--since', '2026-09-01', '--seen-since', '2026-09-10', '-q', 'staff']);
    expect(code).toBe(0);
    const url = new URL(h.requests()[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.atelic.me/v1/work/postings');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'queued,applied', track: 'w2', board: 'greenhouse', since: '2026-09-01', seen_since: '2026-09-10', q: 'staff',
    });
    expect(h.requests()[0]!.headers.get('x-api-key')).toBe('tok_cli');
    const printed = JSON.parse(h.out[0]!);
    expect(printed.data.collection[0].company).toBe('Watershed');
    expect(printed.links.self).toBe('/v1/work/x?page=1');
  });

  it('walks every page with --all', async () => {
    const h = harness((request) => {
      const p = Number(new URL(request.url).searchParams.get('page') ?? '1');
      return p === 1
        ? json(page([posting({ id: 1 })], { page: 1, total_pages: 2, total: 2 }, '/v1/work/postings?page=2&q=staff'))
        : json(page([posting({ id: 2 })], { page: 2, total_pages: 2, total: 2 }, null));
    });
    const code = await h.run(['work', 'postings', 'list', '-q', 'staff', '--all']);
    expect(code).toBe(0);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(new URL(h.requests()[1]!.url).searchParams.get('q')).toBe('staff');
    expect(JSON.parse(h.out[0]!).data.collection.map((p: { id: number }) => p.id)).toEqual([1, 2]);
  });

  it('renders a table with --table', async () => {
    const h = harness(() => json(page([posting()], { page: 1, total_pages: 1, total: 1 }, null)));
    await h.run(['--table', 'work', 'postings', 'list']);
    expect(h.out[0]).toMatch(/^\| Id \| Seen \| Company \| Title \| Status \| Board \| Key \| Verdict \|\n/);
    expect(h.out[0]).toContain('| 1 | 2026-09-14 | Watershed |');
  });

  it('uses --api and PINOLE_API_URL for the base URL', async () => {
    const h = harness(() => json(page([], { page: 1, total_pages: 1, total: 0 }, null)), { env: { PINOLE_API_TOKEN: 't', PINOLE_API_URL: 'http://env.local' } });
    await h.run(['work', 'postings', 'list']);
    expect(h.requests()[0]!.url).toBe('http://env.local/v1/work/postings');
    await h.run(['--api', 'http://flag.local', 'work', 'postings', 'list']);
    expect(h.requests()[1]!.url).toBe('http://flag.local/v1/work/postings');
  });
});

describe('pinole work postings upsert', () => {
  const ok = () => json({ data: { collection: [posting()] }, meta: { created: 1, updated: 0, matched: 0 } });

  it('wraps an array from --file as postings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinole-'));
    const file = join(dir, 'rows.json');
    writeFileSync(file, JSON.stringify([{ company: 'A', title: 'B' }, { company: 'C', title: 'D' }]));
    const h = harness(ok);
    expect(await h.run(['work', 'postings', 'upsert', '--file', file])).toBe(0);
    const request = h.requests()[0]!;
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ postings: [{ company: 'A', title: 'B' }, { company: 'C', title: 'D' }] });
  });

  it('wraps a single object from stdin as posting and renders the entity answer', async () => {
    const entity = () => json({ data: { entity: posting({ id: 9 }) }, meta: {} }, 200);
    const h = harness(entity, { readStdin: () => JSON.stringify({ company: 'A', title: 'B', url: 'https://x' }) });
    expect(await h.run(['--table', 'work', 'postings', 'upsert'])).toBe(0);
    expect(await h.requests()[0]!.json()).toEqual({ posting: { company: 'A', title: 'B', url: 'https://x' } });
    expect(h.out[0]).toContain('| 9 | 2026-09-14 | Watershed |');
  });

  it('fails cleanly on empty stdin', async () => {
    const h = harness(ok);
    expect(await h.run(['work', 'postings', 'upsert'])).toBe(1);
    expect(h.err[0]).toMatch(/Nothing on stdin/);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('pinole work postings update', () => {
  it('PATCHes the given fields under posting', async () => {
    const h = harness(() => json({ data: { entity: posting({ status: 'applied' }) }, meta: {} }));
    expect(await h.run(['work', 'postings', 'update', '7', '--status', 'applied', '--applied-on', '2026-09-16', '--fit-score', '9', '--notes', 'sent'])).toBe(0);
    const request = h.requests()[0]!;
    expect(request.method).toBe('PATCH');
    expect(request.url).toBe('https://api.atelic.me/v1/work/postings/7');
    expect(await request.json()).toEqual({ posting: { status: 'applied', applied_on: '2026-09-16', fit_score: 9, notes: 'sent' } });
  });

  it('refuses an update with no fields', async () => {
    const h = harness(() => json({}));
    expect(await h.run(['work', 'postings', 'update', '7'])).toBe(1);
    expect(h.err[0]).toMatch(/Nothing to update/);
  });
});

describe('pinole work activities list', () => {
  const ok = () => json(page([activity()], { page: 1, total_pages: 1, total: 1 }, null));

  it('passes the week filter through', async () => {
    const h = harness(ok);
    await h.run(['work', 'activities', 'list', '--week', '2026-W38', '--kind', 'application', '--reported', 'false', '--posting', '4']);
    expect(Object.fromEntries(new URL(h.requests()[0]!.url).searchParams)).toEqual({
      week: '2026-W38', kind: 'application', reported: 'false', job_posting_id: '4',
    });
  });

  it('passes the date range through', async () => {
    const h = harness(ok);
    await h.run(['work', 'activities', 'list', '--from', '2026-09-06', '--to', '2026-09-12']);
    expect(Object.fromEntries(new URL(h.requests()[0]!.url).searchParams)).toEqual({ from: '2026-09-06', to: '2026-09-12' });
  });

  it('rejects a reported value other than true or false', async () => {
    const h = harness(ok);
    expect(await h.run(['work', 'activities', 'list', '--reported', 'maybe'])).not.toBe(0);
    expect(h.err.join('\n')).toMatch(/true or false/);
  });

  it('renders the activities table', async () => {
    const h = harness(ok);
    await h.run(['--table', 'work', 'activities', 'list']);
    expect(h.out[0]).toMatch(/^\| Id \| Date \| Kind \| Employer \| Position \| Channel \| Reported \| Notes \|\n/);
  });
});

describe('pinole work activities log', () => {
  const ok = () => json({ data: { collection: [activity()] }, meta: { created: 1 } }, 201);

  it('builds one activity from flags', async () => {
    const h = harness(ok);
    expect(await h.run(['work', 'activities', 'log', '--on', '2026-09-15', '--kind', 'application', '--employer', 'Watershed', '--position', 'Staff', '--posting', '1', '--channel', 'greenhouse', '--notes', 'done'])).toBe(0);
    expect(await h.requests()[0]!.json()).toEqual({
      activity: { performed_on: '2026-09-15', kind: 'application', employer: 'Watershed', position: 'Staff', job_posting_id: 1, channel: 'greenhouse', notes: 'done' },
    });
  });

  it('names the missing required flags', async () => {
    const h = harness(ok);
    expect(await h.run(['work', 'activities', 'log', '--on', '2026-09-15'])).toBe(1);
    expect(h.err[0]).toBe('Missing --kind, --employer.');
  });

  it('wraps an array from --file as activities and an object from stdin as activity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinole-'));
    const file = join(dir, 'rows.json');
    writeFileSync(file, JSON.stringify([{ performed_on: '2026-09-15', kind: 'networking', employer: 'A' }]));
    let calls = 0;
    const answer = () => (++calls === 1 ? ok() : json({ data: { entity: activity({ id: 12, kind: 'interview' }) }, meta: {} }, 201));
    const h = harness(answer, { readStdin: () => JSON.stringify({ performed_on: '2026-09-15', kind: 'interview', employer: 'B' }) });
    await h.run(['work', 'activities', 'log', '--file', file]);
    await h.run(['--table', 'work', 'activities', 'log']);
    expect(h.out[1]).toContain('| 12 | 2026-09-15 | interview |');
    expect(await h.requests()[0]!.json()).toEqual({ activities: [{ performed_on: '2026-09-15', kind: 'networking', employer: 'A' }] });
    expect(await h.requests()[1]!.json()).toEqual({ activity: { performed_on: '2026-09-15', kind: 'interview', employer: 'B' } });
  });
});

describe('pinole work activities report', () => {
  it('issues one PATCH per id with reported true and the confirmation', async () => {
    const h = harness((request) => {
      const id = Number(request.url.split('/').pop());
      return json({ data: { entity: activity({ id, reported: true, confirmation: 'ABC' }) }, meta: {} });
    });
    expect(await h.run(['work', 'activities', 'report', '--confirmation', 'ABC', '10', '11', '12'])).toBe(0);
    const requests = h.requests();
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.url)).toEqual([
      'https://api.atelic.me/v1/work/activities/10',
      'https://api.atelic.me/v1/work/activities/11',
      'https://api.atelic.me/v1/work/activities/12',
    ]);
    for (const r of requests) {
      expect(r.method).toBe('PATCH');
      expect(await r.json()).toEqual({ activity: { reported: true, confirmation: 'ABC' } });
    }
    const printed = JSON.parse(h.out[0]!);
    expect(printed.meta).toEqual({ reported: 3, confirmation: 'ABC' });
    expect(printed.data.collection.map((a: { id: number }) => a.id)).toEqual([10, 11, 12]);
  });

  it('stops at the first failure and exits 1', async () => {
    let calls = 0;
    const h = harness(() => (++calls === 2 ? json({ error: 'Activity not found' }, 404) : json({ data: { entity: activity() }, meta: {} })));
    expect(await h.run(['work', 'activities', 'report', '--confirmation', 'ABC', '10', '99', '12'])).toBe(1);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.err[0]).toBe('Activity not found (HTTP 404)');
  });
});

describe('pinole work activities exclude', () => {
  it('PATCHes the exclusion reason', async () => {
    const h = harness(() => json({ data: { entity: activity({ exclusion_reason: 'duplicate' }) }, meta: {} }));
    expect(await h.run(['work', 'activities', 'exclude', '10', '--reason', 'duplicate'])).toBe(0);
    expect(await h.requests()[0]!.json()).toEqual({ activity: { exclusion_reason: 'duplicate' } });
  });
});

describe('pinole work funnel', () => {
  const funnel = { as_of: '2026-09-16T00:00:00Z', applications: 12, rejected: 3, silent: 4, in_conversation: 1, interviews: 2, withdrawn: 0, disqualified: 1, filled: 1 };

  it('prints the envelope', async () => {
    const h = harness(() => json({ data: { entity: funnel }, meta: {} }));
    expect(await h.run(['work', 'funnel'])).toBe(0);
    expect(h.requests()[0]!.url).toBe('https://api.atelic.me/v1/work/funnel');
    expect(JSON.parse(h.out[0]!)).toEqual({ data: { entity: funnel }, meta: {} });
  });

  it('renders a table', async () => {
    const h = harness(() => json({ data: { entity: funnel }, meta: {} }));
    await h.run(['--table', 'work', 'funnel']);
    expect(h.out[0]).toContain('| in_conversation | 1 |');
  });
});

describe('errors', () => {
  it('prints the server error to stderr and exits 1', async () => {
    const h = harness(() => json({ error: 'Personal access tokens go in X-Api-Key' }, 401));
    expect(await h.run(['work', 'funnel'])).toBe(1);
    expect(h.out).toEqual([]);
    expect(h.err).toEqual(['Personal access tokens go in X-Api-Key (HTTP 401)']);
  });

  it('exits 0 on --help', async () => {
    const h = harness(() => json({}));
    expect(await h.run(['--help'])).toBe(0);
    expect(h.out.join('\n')).toContain('Usage: pinole');
  });
});
