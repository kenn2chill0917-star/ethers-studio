import fs from "fs";
import { createHash } from "crypto";
import { join } from "path";
// What was compiled: the content of each source, keyed by its filename. A watcher
// event for an unchanged source (editors emit several events per save, and a save
// can be a no-op) reuses the cached result instead of recompiling and clobbering
// the results that are currently on screen.
const compiledSources = new Map();
export function sourceKey(content) {
    return createHash("sha256").update(content).digest("hex");
}
export function getCached(filename) {
    return compiledSources.get(filename) || null;
}
export function setCached(filename, key, compiled) {
    compiledSources.set(filename, { key, compiled });
}
// Only used by the tests, to reset the module state between cases
export function clearCache() {
    compiledSources.clear();
}
export function readSource(inPath, filename) {
    try {
        return fs.readFileSync(join(inPath, filename)).toString();
    }
    catch (error) {
        // The file was removed or renamed; forget it and let the caller skip it
        if (error.code === "ENOENT") {
            compiledSources.delete(filename);
            return null;
        }
        throw error;
    }
}
export function isChanged(inPath, filename) {
    const content = readSource(inPath, filename);
    if (content == null) {
        return false;
    }
    const cached = compiledSources.get(filename);
    return (cached == null || cached.key !== sourceKey(content));
}
// Leaves an up-to-date file alone; rewriting it would bump its mtime and make
// the tsc watcher start a compile for output that did not change
export function writeIfChanged(path, content) {
    try {
        if (fs.readFileSync(path).toString() === content) {
            return;
        }
    }
    catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
    fs.writeFileSync(path, content);
}
//# sourceMappingURL=cache.js.map