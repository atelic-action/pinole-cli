import { readFileSync } from 'node:fs';
import { Command, InvalidArgumentError, Option } from 'commander';
import { createClient, resolveBaseUrl, resolveToken, } from './client.js';
import { renderActivities, renderFunnel, renderPostings } from './table.js';
export const defaultIo = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    readStdin: () => readFileSync(0, 'utf8'),
    env: process.env,
};
function parseId(value) {
    const id = Number.parseInt(value, 10);
    if (!Number.isInteger(id) || id <= 0)
        throw new InvalidArgumentError('An id is a positive integer.');
    return id;
}
function parseIntOption(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n))
        throw new InvalidArgumentError('Expected an integer.');
    return n;
}
function parseBoolean(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    throw new InvalidArgumentError('Expected true or false.');
}
/** Rows from a file or stdin: one JSON object or an array of them. */
function readRows(io, file) {
    const raw = file ? readFileSync(file, 'utf8') : io.readStdin();
    if (!raw.trim())
        throw new Error(file ? `${file} is empty.` : 'Nothing on stdin: pass --file or pipe JSON in.');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Could not parse JSON${file ? ` in ${file}` : ' on stdin'}: ${error.message}`);
    }
    if (Array.isArray(parsed))
        return parsed;
    if (parsed && typeof parsed === 'object')
        return parsed;
    throw new Error('Expected a JSON object or an array of objects.');
}
/** Drops undefined values so absent flags never reach the wire. */
function compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
export function buildProgram(io = defaultIo) {
    const program = new Command('pinole')
        .description('The Pinole API command line client.')
        .option('--json', 'JSON output, the raw envelope pretty printed (default)')
        .option('--table', 'Markdown table output')
        .option('--api <url>', 'API base URL (else PINOLE_API_URL, else https://api.atelic.me)')
        .configureOutput({
        writeOut: (str) => io.stdout(str.replace(/\n$/, '')),
        writeErr: (str) => io.stderr(str.replace(/\n$/, '')),
    })
        .showHelpAfterError();
    let client;
    const getClient = (cmd) => {
        if (client)
            return client;
        const opts = cmd.optsWithGlobals();
        client = createClient({
            baseUrl: opts.api ?? resolveBaseUrl(io.env),
            token: resolveToken({ env: io.env }),
            fetch: io.fetch,
        });
        return client;
    };
    const emitFor = (cmd) => {
        const opts = cmd.optsWithGlobals();
        const format = opts.table ? 'table' : 'json';
        return (payload, table) => {
            io.stdout(format === 'table' ? table() : JSON.stringify(payload, null, 2));
        };
    };
    const work = program.command('work').description('The work search domain: postings, activities, and the funnel.');
    // postings
    const postings = work.command('postings').description('Job postings.');
    postings
        .command('list')
        .description('List postings.')
        .option('--status <s[,s]>', 'one status or a comma separated list')
        .option('--track <t>', 'w2 or fractional')
        .option('--board <b>', 'the board the posting came from')
        .option('--since <date>', 'updated on or after this date')
        .option('--seen-since <date>', 'first seen on or after this date')
        .option('-q <text>', 'case insensitive match on company and title')
        .option('--all', 'walk every page')
        .option('--page <n>', 'page number', parseIntOption)
        .option('--per-page <n>', 'rows per page, at most 100', parseIntOption)
        .action(async function () {
        const o = this.opts();
        const query = compact({
            status: o.status, track: o.track, board: o.board, since: o.since, seen_since: o.seenSince,
            q: o.q, page: o.page, per_page: o.perPage,
        });
        const api = getClient(this);
        const result = o.all ? await api.postings.listAll(query) : await api.postings.list(query);
        emitFor(this)(result, () => renderPostings(result.data.collection));
    });
    postings
        .command('upsert')
        .description('Create or update postings from a JSON array or one object, via --file or stdin.')
        .option('--file <path>', 'JSON file of rows; stdin when omitted')
        .action(async function () {
        const { file } = this.opts();
        const rows = readRows(io, file);
        const result = await getClient(this).postings.upsert(rows);
        emitFor(this)(result, () => renderPostings(result.data.collection));
    });
    postings
        .command('update')
        .description('Update one posting.')
        .argument('<id>', 'posting id', parseId)
        .option('--status <s>', 'new status; the transition guard applies')
        .option('--closed-reason <r>', 'required when status is closed')
        .option('--applied-on <date>', 'application date')
        .option('--notes <text>')
        .option('--verdict <text>')
        .option('--fit-score <n>', 'fit score', parseIntOption)
        .action(async function (id) {
        const o = this.opts();
        const posting = compact({
            status: o.status, closed_reason: o.closedReason, applied_on: o.appliedOn,
            notes: o.notes, verdict: o.verdict, fit_score: o.fitScore,
        });
        if (Object.keys(posting).length === 0)
            throw new Error('Nothing to update: pass at least one field flag.');
        const result = await getClient(this).postings.update(id, posting);
        emitFor(this)(result, () => renderPostings([result.data.entity]));
    });
    // activities
    const activities = work.command('activities').description('Work search activities.');
    activities
        .command('list')
        .description('List activities.')
        .option('--week <YYYY-Www>', 'the claim week containing this ISO week')
        .option('--from <date>', 'inclusive start date')
        .option('--to <date>', 'inclusive end date')
        .option('--kind <k>', 'activity kind')
        .addOption(new Option('--reported <bool>', 'true or false').argParser(parseBoolean))
        .option('--posting <id>', 'job posting id', parseId)
        .option('--all', 'walk every page')
        .option('--page <n>', 'page number', parseIntOption)
        .option('--per-page <n>', 'rows per page, at most 100', parseIntOption)
        .action(async function () {
        const o = this.opts();
        const query = compact({
            week: o.week, from: o.from, to: o.to, kind: o.kind, reported: o.reported,
            job_posting_id: o.posting, page: o.page, per_page: o.perPage,
        });
        const api = getClient(this);
        const result = o.all ? await api.activities.listAll(query) : await api.activities.list(query);
        emitFor(this)(result, () => renderActivities(result.data.collection));
    });
    activities
        .command('log')
        .description('Log activities from --file or stdin, or one activity from flags.')
        .option('--file <path>', 'JSON file of rows; stdin when no flags are given')
        .option('--on <date>', 'performed on')
        .option('--kind <k>', 'activity kind')
        .option('--employer <name>')
        .option('--position <title>')
        .option('--url <url>')
        .option('--posting <id>', 'job posting id', parseId)
        .option('--channel <c>')
        .option('--notes <text>')
        .action(async function () {
        const o = this.opts();
        const flagged = compact({
            performed_on: o.on, kind: o.kind, employer: o.employer, position: o.position,
            url: o.url, job_posting_id: o.posting, channel: o.channel, notes: o.notes,
        });
        const usingFlags = Object.keys(flagged).length > 0;
        if (usingFlags && o.file)
            throw new Error('Pass either --file or the activity flags, not both.');
        let rows;
        if (usingFlags) {
            const missing = ['performed_on', 'kind', 'employer'].filter((k) => flagged[k] === undefined);
            if (missing.length) {
                const flags = { performed_on: '--on', kind: '--kind', employer: '--employer' };
                throw new Error(`Missing ${missing.map((k) => flags[k]).join(', ')}.`);
            }
            rows = flagged;
        }
        else {
            rows = readRows(io, o.file);
        }
        const result = await getClient(this).activities.log(rows);
        emitFor(this)(result, () => renderActivities(result.data.collection));
    });
    activities
        .command('report')
        .description('Mark activities reported, one PATCH per id.')
        .requiredOption('--confirmation <code>', 'the confirmation code from the claim')
        .argument('<ids...>', 'activity ids', (value, previous = []) => [...previous, parseId(value)])
        .action(async function (ids) {
        const { confirmation } = this.opts();
        const api = getClient(this);
        const reported = [];
        for (const id of ids) {
            const result = await api.activities.update(id, { reported: true, confirmation });
            reported.push(result.data.entity);
        }
        const payload = { data: { collection: reported }, meta: { reported: reported.length, confirmation } };
        emitFor(this)(payload, () => renderActivities(reported));
    });
    activities
        .command('exclude')
        .description('Record why an activity is excluded from the claim.')
        .argument('<id>', 'activity id', parseId)
        .requiredOption('--reason <text>', 'the exclusion reason')
        .action(async function (id) {
        const { reason } = this.opts();
        const result = await getClient(this).activities.update(id, { exclusion_reason: reason });
        emitFor(this)(result, () => renderActivities([result.data.entity]));
    });
    // funnel
    work
        .command('funnel')
        .description('The application funnel counts.')
        .action(async function () {
        const result = await getClient(this).funnel();
        emitFor(this)(result, () => renderFunnel(result.data.entity));
    });
    return program;
}
/** Parses argv, prints any failure to stderr, and returns the exit code. */
export async function run(argv, io = defaultIo) {
    const program = buildProgram(io).exitOverride();
    try {
        await program.parseAsync(argv, { from: 'user' });
        return 0;
    }
    catch (error) {
        if (error && typeof error === 'object' && 'exitCode' in error && 'code' in error) {
            // A commander exit: help or version printed, or a usage error already reported.
            const code = error;
            return code.code === 'commander.helpDisplayed' || code.code === 'commander.version' ? 0 : code.exitCode || 1;
        }
        io.stderr(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
