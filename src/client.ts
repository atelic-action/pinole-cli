import { execFileSync } from 'node:child_process';
import createOpenapiClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/schema.js';

export const DEFAULT_BASE_URL = 'https://api.atelic.me';
export const TOKEN_ENV = 'PINOLE_API_TOKEN';
export const BASE_URL_ENV = 'PINOLE_API_URL';
export const KEYCHAIN_SERVICE = 'pinole-mcp-token';

export type Posting = components['schemas']['Posting'];
export type PostingInput = components['schemas']['PostingInput'];
export type PostingEnvelope = components['schemas']['PostingEnvelope'];
export type PostingCollection = components['schemas']['PostingCollection'];
export type PostingBulkResult = components['schemas']['PostingBulkResult'];
export type Activity = components['schemas']['Activity'];
export type ActivityInput = components['schemas']['ActivityInput'];
export type ActivityEnvelope = components['schemas']['ActivityEnvelope'];
export type ActivityCollection = components['schemas']['ActivityCollection'];
export type ActivityBulkResult = components['schemas']['ActivityBulkResult'];
export type Funnel = components['schemas']['Funnel'];
export type FunnelEnvelope = components['schemas']['FunnelEnvelope'];
export type PaginationMeta = components['schemas']['PaginationMeta'];
export type Links = components['schemas']['Links'];

export type PostingListQuery = NonNullable<paths['/v1/work/postings']['get']['parameters']['query']>;
export type ActivityListQuery = NonNullable<paths['/v1/work/activities']['get']['parameters']['query']>;

/** A non 2xx answer from the API, carrying the server's error text and status. */
export class PinoleApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, serverError: string, body: unknown) {
    super(`${serverError} (HTTP ${status})`);
    this.name = 'PinoleApiError';
    this.status = status;
    this.body = body;
  }
}

export interface TokenSources {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Reads the Keychain entry; the default shells out to `security`. */
  keychain?: () => string;
}

function readKeychain(): string {
  return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * The token, from PINOLE_API_TOKEN first, then the macOS Keychain entry
 * pinole-mcp-token. Never logged.
 */
export function resolveToken(sources: TokenSources = {}): string {
  const env = sources.env ?? process.env;
  const platform = sources.platform ?? process.platform;
  const fromEnv = env[TOKEN_ENV]?.trim();
  if (fromEnv) return fromEnv;

  const sourcesHint = `Set ${TOKEN_ENV}, or on macOS store the token in the Keychain under service ${KEYCHAIN_SERVICE} (security add-generic-password -s ${KEYCHAIN_SERVICE} -a pinole -w <token>).`;

  if (platform !== 'darwin') {
    throw new Error(`No Pinole API token found. ${sourcesHint}`);
  }

  let fromKeychain = '';
  try {
    fromKeychain = (sources.keychain ?? readKeychain)().trim();
  } catch {
    throw new Error(`No Pinole API token found: ${TOKEN_ENV} is unset and the Keychain has no ${KEYCHAIN_SERVICE} entry. ${sourcesHint}`);
  }
  if (!fromKeychain) {
    throw new Error(`No Pinole API token found: ${TOKEN_ENV} is unset and the Keychain ${KEYCHAIN_SERVICE} entry is empty. ${sourcesHint}`);
  }
  return fromKeychain;
}

/** The base URL, from PINOLE_API_URL, else https://api.atelic.me. */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[BASE_URL_ENV]?.trim();
  return (fromEnv || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function readError(response: Response): Promise<PinoleApiError> {
  const text = await response.text();
  let body: unknown = text;
  let message = text || response.statusText || `HTTP ${response.status}`;
  try {
    body = JSON.parse(text);
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      message = body.error;
      if ('row' in body && typeof body.row === 'number') {
        const errors = 'errors' in body ? JSON.stringify(body.errors) : '';
        message = `${message} (row ${body.row}${errors ? `: ${errors}` : ''})`;
      } else if ('details' in body && body.details !== undefined) {
        message = `${message} (${JSON.stringify(body.details)})`;
      }
    }
  } catch {
    // Not JSON; the raw text stands as the message.
  }
  return new PinoleApiError(response.status, message, body);
}

const raiseOnError: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response;
    throw await readError(response);
  },
};

export interface ClientOptions {
  baseUrl?: string | undefined;
  token?: string | undefined;
  /** Overrides global fetch; tests inject one. */
  fetch?: typeof globalThis.fetch | undefined;
}

/** Query parameters parsed out of a links.next URL, relative or absolute. */
export function queryFromLink(link: string): Record<string, string> {
  const url = new URL(link, DEFAULT_BASE_URL);
  return Object.fromEntries(url.searchParams.entries());
}

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '');
  const token = options.token ?? resolveToken();
  const baseFetch = options.fetch ?? globalThis.fetch;
  const reachableFetch: typeof globalThis.fetch = async (input, init) => {
    try {
      return await baseFetch(input, init);
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : (error as Error).message;
      throw new Error(`Could not reach ${baseUrl}: ${cause}`);
    }
  };
  const api = createOpenapiClient<paths>({
    baseUrl,
    headers: { 'X-Api-Key': token, Accept: 'application/json' },
    fetch: reachableFetch,
  });
  api.use(raiseOnError);

  async function walk<T, Q extends Record<string, unknown>>(
    fetchPage: (query: Q) => Promise<{ data: { collection: T[] }; meta: PaginationMeta; links: Links }>,
    query: Q,
  ): Promise<{ data: { collection: T[] }; meta: PaginationMeta }> {
    const rows: T[] = [];
    let page = await fetchPage(query);
    rows.push(...page.data.collection);
    let guard = 0;
    while (page.links?.next) {
      if (++guard > 10_000) throw new Error('Pagination did not terminate: links.next never emptied.');
      page = await fetchPage({ ...query, ...queryFromLink(page.links.next) } as Q);
      rows.push(...page.data.collection);
    }
    return {
      data: { collection: rows },
      meta: { page: 1, per_page: rows.length, total: page.meta?.total ?? rows.length, total_pages: 1 },
    };
  }

  const postings = {
    async list(query: PostingListQuery = {}): Promise<PostingCollection> {
      const { data } = await api.GET('/v1/work/postings', { params: { query } });
      return data as PostingCollection;
    },
    listAll(query: PostingListQuery = {}) {
      return walk<Posting, PostingListQuery>((q) => postings.list(q), query);
    },
    async upsert(rows: PostingInput | PostingInput[]): Promise<PostingBulkResult> {
      const body = Array.isArray(rows) ? { postings: rows } : { posting: rows };
      const { data } = await api.POST('/v1/work/postings', { body });
      return data as PostingBulkResult;
    },
    async update(id: number, posting: PostingInput): Promise<PostingEnvelope> {
      const { data } = await api.PATCH('/v1/work/postings/{id}', { params: { path: { id } }, body: { posting } });
      return data as PostingEnvelope;
    },
    async remove(id: number): Promise<void> {
      await api.DELETE('/v1/work/postings/{id}', { params: { path: { id } } });
    },
  };

  const activities = {
    async list(query: ActivityListQuery = {}): Promise<ActivityCollection> {
      const { data } = await api.GET('/v1/work/activities', { params: { query } });
      return data as ActivityCollection;
    },
    listAll(query: ActivityListQuery = {}) {
      return walk<Activity, ActivityListQuery>((q) => activities.list(q), query);
    },
    async log(rows: ActivityInput | ActivityInput[]): Promise<ActivityBulkResult> {
      const body = Array.isArray(rows) ? { activities: rows } : { activity: rows };
      const { data } = await api.POST('/v1/work/activities', { body });
      return data as ActivityBulkResult;
    },
    async update(id: number, activity: ActivityInput): Promise<ActivityEnvelope> {
      const { data } = await api.PATCH('/v1/work/activities/{id}', { params: { path: { id } }, body: { activity } });
      return data as ActivityEnvelope;
    },
    async remove(id: number): Promise<void> {
      await api.DELETE('/v1/work/activities/{id}', { params: { path: { id } } });
    },
  };

  async function funnel(): Promise<FunnelEnvelope> {
    const { data } = await api.GET('/v1/work/funnel');
    return data as FunnelEnvelope;
  }

  return { api, baseUrl, postings, activities, funnel };
}

export type PinoleClient = ReturnType<typeof createClient>;
