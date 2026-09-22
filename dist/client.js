import { execFileSync } from 'node:child_process';
import createOpenapiClient from 'openapi-fetch';
export const DEFAULT_BASE_URL = 'https://api.atelic.me';
export const TOKEN_ENV = 'PINOLE_API_TOKEN';
export const BASE_URL_ENV = 'PINOLE_API_URL';
export const KEYCHAIN_SERVICE = 'pinole-mcp-token';
/** A non 2xx answer from the API, carrying the server's error text and status. */
export class PinoleApiError extends Error {
    status;
    body;
    constructor(status, serverError, body) {
        super(`${serverError} (HTTP ${status})`);
        this.name = 'PinoleApiError';
        this.status = status;
        this.body = body;
    }
}
function readKeychain() {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
}
/**
 * The token, from PINOLE_API_TOKEN first, then the macOS Keychain entry
 * pinole-mcp-token. Never logged.
 */
export function resolveToken(sources = {}) {
    const env = sources.env ?? process.env;
    const platform = sources.platform ?? process.platform;
    const fromEnv = env[TOKEN_ENV]?.trim();
    if (fromEnv)
        return fromEnv;
    const sourcesHint = `Set ${TOKEN_ENV}, or on macOS store the token in the Keychain under service ${KEYCHAIN_SERVICE} (security add-generic-password -s ${KEYCHAIN_SERVICE} -a pinole -w <token>).`;
    if (platform !== 'darwin') {
        throw new Error(`No Pinole API token found. ${sourcesHint}`);
    }
    let fromKeychain = '';
    try {
        fromKeychain = (sources.keychain ?? readKeychain)().trim();
    }
    catch {
        throw new Error(`No Pinole API token found: ${TOKEN_ENV} is unset and the Keychain has no ${KEYCHAIN_SERVICE} entry. ${sourcesHint}`);
    }
    if (!fromKeychain) {
        throw new Error(`No Pinole API token found: ${TOKEN_ENV} is unset and the Keychain ${KEYCHAIN_SERVICE} entry is empty. ${sourcesHint}`);
    }
    return fromKeychain;
}
/** The base URL, from PINOLE_API_URL, else https://api.atelic.me. */
export function resolveBaseUrl(env = process.env) {
    const fromEnv = env[BASE_URL_ENV]?.trim();
    return (fromEnv || DEFAULT_BASE_URL).replace(/\/+$/, '');
}
async function readError(response) {
    const text = await response.text();
    let body = text;
    let message = text || response.statusText || `HTTP ${response.status}`;
    try {
        body = JSON.parse(text);
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
            message = body.error;
            if ('row' in body && typeof body.row === 'number') {
                const errors = 'errors' in body ? JSON.stringify(body.errors) : '';
                message = `${message} (row ${body.row}${errors ? `: ${errors}` : ''})`;
            }
            else if ('details' in body && body.details !== undefined) {
                message = `${message} (${JSON.stringify(body.details)})`;
            }
        }
    }
    catch {
        // Not JSON; the raw text stands as the message.
    }
    return new PinoleApiError(response.status, message, body);
}
const raiseOnError = {
    async onResponse({ response }) {
        if (response.ok)
            return response;
        throw await readError(response);
    },
};
/** Query parameters parsed out of a links.next URL, relative or absolute. */
export function queryFromLink(link) {
    const url = new URL(link, DEFAULT_BASE_URL);
    return Object.fromEntries(url.searchParams.entries());
}
export function createClient(options = {}) {
    const baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '');
    const token = options.token ?? resolveToken();
    const baseFetch = options.fetch ?? globalThis.fetch;
    const reachableFetch = async (input, init) => {
        try {
            return await baseFetch(input, init);
        }
        catch (error) {
            const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error.message;
            throw new Error(`Could not reach ${baseUrl}: ${cause}`);
        }
    };
    const api = createOpenapiClient({
        baseUrl,
        headers: { 'X-Api-Key': token, Accept: 'application/json' },
        fetch: reachableFetch,
    });
    api.use(raiseOnError);
    async function walk(fetchPage, query) {
        const rows = [];
        let page = await fetchPage(query);
        rows.push(...page.data.collection);
        let guard = 0;
        // An empty page, or one at or past total_pages, ends the walk whatever
        // links.next says: an API that once built `page=` for an empty read sent
        // this loop round to the guard below (the W39 recruiter run, 2026-09-22).
        while (page.links?.next && page.data.collection.length > 0 && (page.meta?.page ?? 0) < (page.meta?.total_pages ?? Infinity)) {
            if (++guard > 10_000)
                throw new Error('Pagination did not terminate: links.next never emptied.');
            page = await fetchPage({ ...query, ...queryFromLink(page.links.next) });
            rows.push(...page.data.collection);
        }
        return {
            data: { collection: rows },
            meta: { page: 1, per_page: rows.length, total: page.meta?.total ?? rows.length, total_pages: 1 },
        };
    }
    async function upsertPostings(rows) {
        const body = Array.isArray(rows) ? { postings: rows } : { posting: rows };
        const { data } = await api.POST('/v1/work/postings', { body });
        return data;
    }
    async function logActivities(rows) {
        const body = Array.isArray(rows) ? { activities: rows } : { activity: rows };
        const { data } = await api.POST('/v1/work/activities', { body });
        return data;
    }
    const postings = {
        async list(query = {}) {
            const { data } = await api.GET('/v1/work/postings', { params: { query } });
            return data;
        },
        listAll(query = {}) {
            return walk((q) => postings.list(q), query);
        },
        upsert: upsertPostings,
        async update(id, posting) {
            const { data } = await api.PATCH('/v1/work/postings/{id}', { params: { path: { id } }, body: { posting } });
            return data;
        },
        async remove(id) {
            await api.DELETE('/v1/work/postings/{id}', { params: { path: { id } } });
        },
    };
    const activities = {
        async list(query = {}) {
            const { data } = await api.GET('/v1/work/activities', { params: { query } });
            return data;
        },
        listAll(query = {}) {
            return walk((q) => activities.list(q), query);
        },
        log: logActivities,
        async update(id, activity) {
            const { data } = await api.PATCH('/v1/work/activities/{id}', { params: { path: { id } }, body: { activity } });
            return data;
        },
        async remove(id) {
            await api.DELETE('/v1/work/activities/{id}', { params: { path: { id } } });
        },
    };
    async function funnel() {
        const { data } = await api.GET('/v1/work/funnel');
        return data;
    }
    return { api, baseUrl, postings, activities, funnel };
}
