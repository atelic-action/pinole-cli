import { describe, expect, it } from 'vitest';
import { cell, renderActivities, renderFunnel, renderPostings } from '../src/table.js';
import { activity, posting } from './fixtures.js';

describe('cell', () => {
  it('escapes pipes, flattens newlines, and blanks null', () => {
    expect(cell('a|b\nc\r\nd')).toBe('a\\|b c d');
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
    expect(cell(false)).toBe('false');
    expect(cell(7)).toBe('7');
  });
});

describe('renderPostings', () => {
  it('renders the postings columns', () => {
    const out = renderPostings([
      posting(),
      posting({ id: 2, company: 'Acme | Co', title: 'Line\nbreak', status: 'queued', board: null, key: null, verdict: null }),
    ]);
    expect(out).toBe(
      [
        '| Id | Seen | Company | Title | Status | Board | Key | Verdict |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 1 | 2026-09-14 | Watershed | Staff Engineer, Growth | shortlisted | greenhouse | greenhouse,watershed,123 | strong fit |',
        '| 2 | 2026-09-14 | Acme \\| Co | Line break | queued |  |  |  |',
      ].join('\n'),
    );
  });
});

describe('renderActivities', () => {
  it('renders the activities columns', () => {
    const out = renderActivities([
      activity(),
      activity({ id: 11, kind: 'follow_up', position: null, channel: 'email', reported: true, notes: 'pinged | again\ntwice' }),
    ]);
    expect(out).toBe(
      [
        '| Id | Date | Kind | Employer | Position | Channel | Reported | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '| 10 | 2026-09-15 | application | Watershed | Staff Engineer, Growth | greenhouse | false |  |',
        '| 11 | 2026-09-15 | follow_up | Watershed |  | email | true | pinged \\| again twice |',
      ].join('\n'),
    );
  });
});

describe('renderFunnel', () => {
  it('renders one row per measure', () => {
    const out = renderFunnel({
      as_of: '2026-09-16T00:00:00Z', applications: 12, rejected: 3, silent: 4, in_conversation: 1,
      interviews: 2, withdrawn: 0, disqualified: 1, filled: 1,
    });
    expect(out.split('\n')).toHaveLength(11);
    expect(out).toContain('| applications | 12 |');
  });
});
