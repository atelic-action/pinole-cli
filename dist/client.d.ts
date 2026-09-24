import type { components, paths } from './generated/schema.js';
export declare const DEFAULT_BASE_URL = "https://api.pinole.dev";
export declare const TOKEN_ENV = "PINOLE_API_TOKEN";
export declare const BASE_URL_ENV = "PINOLE_API_URL";
export declare const KEYCHAIN_SERVICE = "pinole-mcp-token";
export type Posting = components['schemas']['Posting'];
export type PostingInput = components['schemas']['PostingInput'];
export type PostingEnvelope = components['schemas']['PostingEntity'];
export type PostingCollection = components['schemas']['PostingCollection'];
export type PostingBulkResult = components['schemas']['PostingBulk'];
export type Activity = components['schemas']['Activity'];
export type ActivityInput = components['schemas']['ActivityInput'];
export type ActivityEnvelope = components['schemas']['ActivityEntity'];
export type ActivityCollection = components['schemas']['ActivityCollection'];
export type ActivityBulkResult = components['schemas']['ActivityBulk'];
export type Funnel = components['schemas']['Funnel'];
export type FunnelEnvelope = components['schemas']['FunnelEntity'];
export type PaginationMeta = components['schemas']['PaginationMeta'];
export type Links = components['schemas']['PaginationLinks'];
export type PostingListQuery = NonNullable<paths['/v1/work/postings']['get']['parameters']['query']>;
export type ActivityListQuery = NonNullable<paths['/v1/work/activities']['get']['parameters']['query']>;
/** A non 2xx answer from the API, carrying the server's error text and status. */
export declare class PinoleApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, serverError: string, body: unknown);
}
export interface TokenSources {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /** Reads the Keychain entry; the default shells out to `security`. */
    keychain?: () => string;
}
/**
 * The token, from PINOLE_API_TOKEN first, then the macOS Keychain entry
 * pinole-mcp-token. Never logged.
 */
export declare function resolveToken(sources?: TokenSources): string;
/** The base URL, from PINOLE_API_URL, else https://api.pinole.dev. */
export declare function resolveBaseUrl(env?: NodeJS.ProcessEnv): string;
export interface ClientOptions {
    baseUrl?: string | undefined;
    token?: string | undefined;
    /** Overrides global fetch; tests inject one. */
    fetch?: typeof globalThis.fetch | undefined;
}
/** Query parameters parsed out of a links.next URL, relative or absolute. */
export declare function queryFromLink(link: string): Record<string, string>;
export declare function createClient(options?: ClientOptions): {
    api: import("openapi-fetch").Client<paths, `${string}/${string}`>;
    baseUrl: string;
    postings: {
        list(query?: PostingListQuery): Promise<PostingCollection>;
        listAll(query?: PostingListQuery): Promise<{
            data: {
                collection: {
                    id: number;
                    company: string;
                    title: string;
                    url?: string | null;
                    key?: string | null;
                    board?: string | null;
                    track: "w2" | "fractional";
                    status: "rejected" | "shortlisted" | "flagged" | "queued" | "applied" | "interviewing" | "closed";
                    closed_reason?: "declined" | "silent" | "withdrawn" | "disqualified" | "filled" | null;
                    verdict?: string | null;
                    fit_score?: number | null;
                    first_seen_on: string;
                    applied_on?: string | null;
                    notes?: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            meta: PaginationMeta;
        }>;
        upsert: {
            (rows: PostingInput[]): Promise<PostingBulkResult>;
            (row: PostingInput): Promise<PostingEnvelope>;
        };
        update(id: number, posting: PostingInput): Promise<PostingEnvelope>;
        remove(id: number): Promise<void>;
    };
    activities: {
        list(query?: ActivityListQuery): Promise<ActivityCollection>;
        listAll(query?: ActivityListQuery): Promise<{
            data: {
                collection: {
                    id: number;
                    performed_on: string;
                    kind: "application" | "follow_up" | "networking" | "listings_review" | "registration" | "registration_maintenance" | "resume_submission" | "interview";
                    employer: string;
                    position?: string | null;
                    url?: string | null;
                    job_posting_id?: number | null;
                    channel?: string | null;
                    notes?: string | null;
                    reported: boolean;
                    reported_at?: string | null;
                    confirmation?: string | null;
                    exclusion_reason?: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            meta: PaginationMeta;
        }>;
        log: {
            (rows: ActivityInput[]): Promise<ActivityBulkResult>;
            (row: ActivityInput): Promise<ActivityEnvelope>;
        };
        update(id: number, activity: ActivityInput): Promise<ActivityEnvelope>;
        remove(id: number): Promise<void>;
    };
    funnel: () => Promise<FunnelEnvelope>;
};
export type PinoleClient = ReturnType<typeof createClient>;
