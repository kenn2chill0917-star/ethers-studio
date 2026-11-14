import assert from "assert";
import { describe, it } from "node:test";

import { repeat, stripBlockComments, stripInlineComments } from "../utils.js";

describe("repeat", function() {
    it("produces a string of exactly the requested length", function() {
        assert.equal(repeat(" ", 5), "     ");
        assert.equal(repeat("x", 0), "");
    });

    it("truncates when the pattern does not divide evenly", function() {
        assert.equal(repeat("ab", 5), "ababa");
    });

    it("returns the pattern itself when it is already long enough", function() {
        assert.equal(repeat("abcdef", 3), "abc");
    });

    it("throws on an empty pattern, which could never terminate", function() {
        assert.throws(() => repeat("", 5), { message: "invalid string" });
    });
});

describe("stripBlockComments", function() {
    it("blanks a comment while preserving the surrounding code", function() {
        const stripped = stripBlockComments("a /* hide */ b");

        assert.ok(!stripped.includes("hide"));
        assert.ok(stripped.includes("a "));
        assert.ok(stripped.includes(" b"));
    });

    it("preserves the offset of code that follows a comment", function() {
        const code = "contract /* note */ Foo { }";
        const stripped = stripBlockComments(code);

        // Offsets must survive, so solc error positions stay correct; the two
        // space pad is the function's own, applied to both ends
        assert.equal(stripped.length, code.length + 4);
        assert.equal(stripped.indexOf("Foo"), code.indexOf("Foo") + 2);
    });

    it("blanks every comment on a line", function() {
        const stripped = stripBlockComments("a /* one */ b /* two */ c");

        assert.ok(!stripped.includes("one"));
        assert.ok(!stripped.includes("two"));
        assert.ok(stripped.includes(" b "));
    });

    // The implementation maps over `comment.split("\n")` to blank a comment line
    // by line, but its regex has no `s` flag, so `.` never matches a newline and
    // a multi-line comment is left completely intact. Marked todo rather than
    // asserted, so the gap is recorded without enshrining it as expected.
    it.todo("preserves the line count of a multi-line comment");

    it("leaves comment-free code alone apart from the pad", function() {
        const code = "contract Foo { }";

        assert.equal(stripBlockComments(code), "  " + code + "  ");
    });
});

describe("stripInlineComments", function() {
    it("strips from the slashes to the end of the line", function() {
        const stripped = stripInlineComments("uint256 x; // hide this");

        assert.ok(!stripped.includes("hide"));
        assert.ok(stripped.startsWith("uint256 x; "));
    });

    it("preserves the length of a line it strips", function() {
        const line = "uint256 x; // hide this";

        assert.equal(stripInlineComments(line).length, line.length);
    });

    it("leaves lines without a comment untouched", function() {
        const code = "contract Foo {\n    uint256 x;\n}";

        assert.equal(stripInlineComments(code), code);
    });

    it("strips each commented line independently", function() {
        const stripped = stripInlineComments("a // one\nb\nc // two").split("\n");

        assert.equal(stripped.length, 3);
        assert.ok(!stripped[0].includes("one"));
        assert.equal(stripped[1], "b");
        assert.ok(!stripped[2].includes("two"));
    });
});
