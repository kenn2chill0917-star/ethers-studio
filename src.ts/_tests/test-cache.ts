import assert from "assert";
import fs from "fs";
import os from "os";
import { join } from "path";
import { after, beforeEach, describe, it } from "node:test";

import {
    clearCache, isChanged, readSource, setCached, sourceKey, writeIfChanged
} from "../cache.js";

import type { Compiled } from "../solidity.js";

// The cache only ever stores and compares the key; the Compiled payload is
// returned untouched, so a placeholder keeps these tests off of solc
const PLACEHOLDER = { contracts: [ ], errors: [ ], warnings: [ ] } as unknown as Compiled;

const tempDirs: Array<string> = [ ];

function makeDir(): string {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "ethers-studio-test-"));
    tempDirs.push(dir);
    return dir;
}

// Caches a file by its current content, the way a successful compile would
function cache(dir: string, filename: string): void {
    const content = fs.readFileSync(join(dir, filename)).toString();
    setCached(filename, sourceKey(content), PLACEHOLDER);
}

after(() => {
    for (const dir of tempDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

beforeEach(() => { clearCache(); });

describe("sourceKey", function() {
    it("returns the same key for identical content", function() {
        const code = "pragma solidity ^0.8.0;\ncontract Foo { }\n";
        assert.equal(sourceKey(code), sourceKey(code));
    });

    it("returns a different key once the content changes", function() {
        const before = "contract Foo { }\n";
        const after = "contract Foo { uint256 x; }\n";
        assert.notEqual(sourceKey(before), sourceKey(after));
    });

    it("distinguishes content that differs only in whitespace", function() {
        assert.notEqual(sourceKey("contract Foo { }"), sourceKey("contract  Foo { }"));
    });
});

describe("isChanged", function() {
    it("reports a file it has never seen as changed", function() {
        const dir = makeDir();
        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { }\n");

        assert.ok(isChanged(dir, "Foo.sol"));
    });

    it("ignores a no-op save that rewrites identical content", function() {
        const dir = makeDir();
        const code = "contract Foo { }\n";
        fs.writeFileSync(join(dir, "Foo.sol"), code);
        cache(dir, "Foo.sol");

        // What an editor emitting duplicate events for one save looks like
        fs.writeFileSync(join(dir, "Foo.sol"), code);

        assert.equal(isChanged(dir, "Foo.sol"), false);
    });

    it("detects a real edit", function() {
        const dir = makeDir();
        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { }\n");
        cache(dir, "Foo.sol");

        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { uint256 x; }\n");

        assert.ok(isChanged(dir, "Foo.sol"));
    });

    it("reports a missing file as unchanged, rather than throwing", function() {
        const dir = makeDir();

        assert.equal(isChanged(dir, "Gone.sol"), false);
    });

    it("tracks each file separately", function() {
        const dir = makeDir();
        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { }\n");
        fs.writeFileSync(join(dir, "Bar.sol"), "contract Bar { }\n");
        cache(dir, "Foo.sol");

        assert.equal(isChanged(dir, "Foo.sol"), false);
        assert.ok(isChanged(dir, "Bar.sol"));
    });
});

describe("readSource", function() {
    it("returns the file content", function() {
        const dir = makeDir();
        const code = "contract Foo { }\n";
        fs.writeFileSync(join(dir, "Foo.sol"), code);

        assert.equal(readSource(dir, "Foo.sol"), code);
    });

    it("returns null and evicts the cache entry when the file is gone", function() {
        const dir = makeDir();
        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { }\n");
        cache(dir, "Foo.sol");
        fs.rmSync(join(dir, "Foo.sol"));

        assert.equal(readSource(dir, "Foo.sol"), null);

        // Having been evicted, a file restored with the old content is a change
        fs.writeFileSync(join(dir, "Foo.sol"), "contract Foo { }\n");
        assert.ok(isChanged(dir, "Foo.sol"));
    });

    it("rethrows errors that are not ENOENT", function() {
        const dir = makeDir();
        fs.mkdirSync(join(dir, "subdir"));

        // Reading a directory fails with EISDIR, which must not be swallowed
        assert.throws(() => readSource(dir, "subdir"), (error: NodeJS.ErrnoException) => {
            return error.code !== "ENOENT";
        });
    });
});

describe("writeIfChanged", function() {
    it("creates a file that does not exist yet", function() {
        const dir = makeDir();
        const path = join(dir, "Foo.ts");

        writeIfChanged(path, "export const foo = 1;\n");

        assert.equal(fs.readFileSync(path).toString(), "export const foo = 1;\n");
    });

    it("leaves mtime untouched when the content already matches", function() {
        const dir = makeDir();
        const path = join(dir, "Foo.ts");
        const content = "export const foo = 1;\n";
        fs.writeFileSync(path, content);

        // Backdate, so an unwanted rewrite is unambiguous even on a coarse clock
        const past = new Date(Date.now() - 60000);
        fs.utimesSync(path, past, past);
        const before = fs.statSync(path).mtimeMs;

        writeIfChanged(path, content);

        // A bumped mtime here would restart the tsc watcher for unchanged output
        assert.equal(fs.statSync(path).mtimeMs, before);
    });

    it("writes when the content differs", function() {
        const dir = makeDir();
        const path = join(dir, "Foo.ts");
        fs.writeFileSync(path, "export const foo = 1;\n");

        writeIfChanged(path, "export const foo = 2;\n");

        assert.equal(fs.readFileSync(path).toString(), "export const foo = 2;\n");
    });
});
