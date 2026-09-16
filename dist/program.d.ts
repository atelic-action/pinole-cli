import { Command } from 'commander';
export interface ProgramIo {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    /** Reads all of stdin; the default drains file descriptor 0. */
    readStdin: () => string;
    env: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch | undefined;
}
export declare const defaultIo: ProgramIo;
export declare function buildProgram(io?: ProgramIo): Command;
/** Parses argv, prints any failure to stderr, and returns the exit code. */
export declare function run(argv: string[], io?: ProgramIo): Promise<number>;
