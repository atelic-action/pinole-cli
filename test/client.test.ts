import { describe, expect, it, vi } from 'vitest';
import { createClient, PinoleApiError, queryFromLink, resolveBaseUrl, resolveToken } from '../src/client.js';
import { activity, json, page, posting } from './fixtures.js';

describe('resolveToken', () => {
  it('prefers PINOLE_API_TOKEN', () => {
    const keychain = vi.fn(() => 'from-keychain');
    expect(resolveToken({ env: { PINOLE_API_TOKEN: ' from-env ' }, platform: 'darwin', keychain })).toBe('from-env');
    expect(keychain).not.toHaveBeenCalled();
  });

  it('falls back to the Keychain on darwin', () => {
    const keychain = vi.fn(() => 'from-keychain\n');
    expect(resolveToken({ env: {}, platform: 'darwin', keychain })).toBe('from-keychain');
    expect(keychain).toHaveBeenCalledOnce();
  });

  it('names both sources when neither is available off darwin', () => {
    const keychain = vi.fn(() => 'never');
    expect(() => resolveToken({ env: {}, platform: 'linux', keychain })).toThrow(/PINOLE_API_TOKEN.*pinole-mcp-token/s);
    expect(keychain).not.toHaveBeenCalled();
  });

  it('names both sources when the Keychain lookup fails', () => {
    const keychain = () => {
      throw new Error('The specified item could not be found in the keychain.');
    };
    expect(() => resolveToken({ env: {}, platform: 'darwin', keychain })).toThrow(/PINOLE_API_TOKEN.*pinole-mcp-token/s);
  });

  it('rejects an empty Keychain entry', () => {
    expect(() => resolveToken({ env: {}, platform: 'darwin', keychain: () => '  \n' })).toThrow(/empty/);
  });
});

describe('resolveBaseUrl', () => {
  it('defaults to api.pinole.dev', () => {
    expect(resolveBaseUrl({})).toBe('https://api.pinole.dev');
  });

  it('reads PINOLE_API_URL and strips a trailing slash', () => {
    expect(resolveBaseUrl({ PINOLE_API_URL: 'http://localhost:3000/' })).toBe('http://localhost:3000');
  });
});

describe('queryFromLink', () => {
  it('reads relative and absolute links', () => {
    expect(queryFromLink('/v1/work/postings?page=2&per_page=50')).toEqual({ page: '2', per_page: '50' });
    expect(queryFromLink('https://api.pinole.dev/v1/work/postings?page=3')).toEqual({ page: '3' });
  });
});

describe('createClient', () => {
  const build = (fetch: typeof globalThis.fetch, baseUrl?: string) =>
    createClient({ baseUrl, token: 'tok_123', fetch });

  it('sends X-Api-Key on every call', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/funnel')) return json({ data: { entity: { as_of: 'x' } }, meta: {} });
      if (url.includes('/activities')) return json(page([activity()], { page: 1, total_pages: 1, total: 1 }, null));
      return json(page([posting()], { page: 1, total_pages: 1, total: 1 }, null));
    });
    const client = build(fetch as unknown as typeof globalThis.fetch);
    await client.postings.list();
    await client.postings.upsert([{ company: 'A', title: 'B' }]);
    await client.postings.update(1, { notes: 'n' });
    await client.activities.list();
    await client.activities.log({ performed_on: '2026-09-15', kind: 'application', employer: 'A' });
    await client.activities.update(10, { reported: true, confirmation: 'C' });
    await client.funnel();
    expect(fetch).toHaveBeenCalledTimes(7);
    for (const call of fetch.mock.calls) {
      const request = call[0] as Request;
      expect(request.headers.get('x-api-key')).toBe('tok_123');
    }
  });

  it('honours an explicit base URL', async () => {
    const fetch = vi.fn(async (_input: Request) => json(page([], { page: 1, total_pages: 1, total: 0 }, null)));
    const client = build(fetch as unknown as typeof globalThis.fetch, 'http://localhost:3000/');
    await client.postings.list({ status: 'queued,applied', track: 'w2' });
    const request = fetch.mock.calls[0]![0];
    expect(request.url).toBe('http://localhost:3000/v1/work/postings?status=queued%2Capplied&track=w2');
  });

  it('walks links.next for listAll', async () => {
    const fetch = vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      const p = Number(url.searchParams.get('page') ?? '1');
      expect(url.searchParams.get('status')).toBe('queued');
      if (p === 1) return json(page([posting({ id: 1 })], { page: 1, total_pages: 3, total: 3 }, '/v1/work/postings?status=queued&page=2'));
      if (p === 2) return json(page([posting({ id: 2 })], { page: 2, total_pages: 3, total: 3 }, '/v1/work/postings?status=queued&page=3'));
      return json(page([posting({ id: 3 })], { page: 3, total_pages: 3, total: 3 }, null));
    });
    const client = build(fetch as unknown as typeof globalThis.fetch);
    const all = await client.postings.listAll({ status: 'queued' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(all.data.collection.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(all.meta).toEqual({ page: 1, per_page: 3, total: 3, total_pages: 1 });
  });

  it('stops listAll on an empty page even when links.next is set', async () => {
    const fetch = vi.fn(async () => json(page([], { page: 1, total_pages: 0, total: 0 }, '/v1/work/postings?page&per_page=100')));
    const client = build(fetch as unknown as typeof globalThis.fetch);
    const all = await client.postings.listAll({});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(all.data.collection).toEqual([]);
  });

  it('stops listAll at the last page even when links.next is set', async () => {
    const fetch = vi.fn(async () => json(page([posting({ id: 1 })], { page: 2, total_pages: 2, total: 2 }, '/v1/work/postings?page=3')));
    const client = build(fetch as unknown as typeof globalThis.fetch);
    await client.postings.listAll({});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shapes upsert bodies for one row and for many, and returns the entity or the batch', async () => {
    const fetch = vi.fn(async (input: Request) =>
      ((await input.clone().json()) as { posting?: unknown }).posting
        ? json({ data: { entity: posting() }, meta: {} }, 201)
        : json({ data: { collection: [posting(), posting({ id: 2 })] }, meta: { created: 1, updated: 1, matched: 0 } }, 201),
    );
    const client = build(fetch as unknown as typeof globalThis.fetch);
    const one = await client.postings.upsert({ company: 'A', title: 'B' });
    const many = await client.postings.upsert([{ company: 'A', title: 'B' }, { company: 'C', title: 'D' }]);
    expect(one.data.entity.id).toBe(1);
    expect(many.meta).toEqual({ created: 1, updated: 1, matched: 0 });
    expect(many.data.collection).toHaveLength(2);
    const bodies = await Promise.all(fetch.mock.calls.map((c) => c[0].json()));
    expect(bodies[0]).toEqual({ posting: { company: 'A', title: 'B' } });
    expect(bodies[1]).toEqual({ postings: [{ company: 'A', title: 'B' }, { company: 'C', title: 'D' }] });
    expect(fetch.mock.calls[0]![0].method).toBe('POST');
  });

  it('throws the server error text and status on a non 2xx', async () => {
    const fetch = vi.fn(async () => json({ error: 'Validation failed', row: 1, errors: { company: ["can't be blank"] } }, 422));
    const client = build(fetch as unknown as typeof globalThis.fetch);
    const failure = await client.postings.upsert([{ title: 'x' }]).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PinoleApiError);
    const error = failure as PinoleApiError;
    expect(error.status).toBe(422);
    expect(error.message).toBe('Validation failed (row 1: {"company":["can\'t be blank"]}) (HTTP 422)');
  });

  it('reports the base URL when the network is unreachable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    });
    const client = build(fetch as unknown as typeof globalThis.fetch, 'http://127.0.0.1:9');
    await expect(client.funnel()).rejects.toThrow('Could not reach http://127.0.0.1:9: ECONNREFUSED');
  });
});
