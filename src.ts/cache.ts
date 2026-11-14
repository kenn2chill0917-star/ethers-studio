import fs from "fs";
import { createHash } from "crypto";
import { join } from "path";

import type { Compiled } from "./solidity.js";

export interface CacheEntry {
    key: string;
    compiled: Compiled;
}

// What was compiled: the content of each source, keyed by its filename. A watcher
// event for an unchanged source (editors emit several events per save, and a save
// can be a no-op) reuses the cached result instead of recompiling and clobbering
// the results that are currently on screen.
const compiledSources: Map<string, CacheEntry> = new Map();

export function sourceKey(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

export function getCached(filename: string): null | CacheEntry {
    return compiledSources.get(filename) || null;
}

export function setCached(filename: string, key: string, compiled: Compiled): void {
    compiledSources.set(filename, { key, compiled });
}

// Only used by the tests, to reset the module state between cases
export function clearCache(): void {
    compiledSources.clear();
}

export function readSource(inPath: string, filename: string): null | string {
    try {
        return fs.readFileSync(join(inPath, filename)).toString();
    } catch (error) {
        // The file was removed or renamed; forget it and let the caller skip it
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            compiledSources.delete(filename);
            return null;
        }
        throw error;
    }
}

export function isChanged(inPath: string, filename: string): boolean {
    const content = readSource(inPath, filename);
    if (content == null) { return false; }
    const cached = compiledSources.get(filename);
    return (cached == null || cached.key !== sourceKey(content));
}

// Leaves an up-to-date file alone; rewriting it would bump its mtime and make
// the tsc watcher start a compile for output that did not change
export function writeIfChanged(path: string, content: string): void {
    try {
        if (fs.readFileSync(path).toString() === content) { return; }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
    }
    fs.writeFileSync(path, content);
}
