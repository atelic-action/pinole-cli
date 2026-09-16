import type { Activity, Funnel, Posting } from './client.js';
export declare const POSTING_COLUMNS: readonly ["Id", "Seen", "Company", "Title", "Status", "Board", "Key", "Verdict"];
export declare const ACTIVITY_COLUMNS: readonly ["Id", "Date", "Kind", "Employer", "Position", "Channel", "Reported", "Notes"];
/** One cell: null and undefined print empty, pipes are escaped, newlines become spaces. */
export declare function cell(value: unknown): string;
export declare function renderTable(columns: readonly string[], rows: readonly (readonly unknown[])[]): string;
export declare function renderPostings(postings: readonly Posting[]): string;
export declare function renderActivities(activities: readonly Activity[]): string;
export declare function renderFunnel(funnel: Funnel): string;
