import fs from "fs";
import { createHash } from "crypto";
import { join, parse, resolve } from "path";
import { spawn } from "child_process";
import { compile } from "./solidity.js";
function getRecusriveType(type, callback) {
    if (type.isArray()) {
        const str = callback(type.arrayChildren);
        if (type.arrayLength >= 0) {
            const types = [];
            for (let i = 0; i < type.arrayLength; i++) {
                types.push(str);
            }
            return `[ ${types.join(", ")} ]`;
        }
        return `Array<${str}>`;
    }
    //if (type.isTuple()) {
    //}
    throw new Error(`unsupported type: ${type.type}`);
}
function getType(type) {
    if (type.baseType.match(/^bytes([0-9]*)$/)) {
        return "string";
    }
    if (type.baseType.match(/^u?int([0-9]*)$/)) {
        return "bigint";
    }
    switch (type.baseType) {
        case "address": return "string";
        case "bool": return "boolean";
        case "string": return "string";
        case "array":
    }
    return getRecusriveType(type, getType);
}
function getLooseType(type) {
    if (type.type.match(/^bytes([0-9]*)$/)) {
        return "ethers.BytesLike";
    }
    if (type.type.match(/^u?int([0-9]*)$/)) {
        return "ethers.BigNumberish";
    }
    switch (type.baseType) {
        case "address": return "ethers.AddressLike";
        case "bool": return "boolean";
        case "string": return "string";
    }
    return getRecusriveType(type, getLooseType);
}
function generateTypeScript(contract) {
    let output = [];
    output.push(`/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/`);
    output.push(`/\/ Contract: ${contract.name}`);
    output.push(`/\/ File:     ${contract.filename}`);
    output.push("");
    output.push(`interface ${contract.name}Interface {`);
    contract.abi.forEachFunction((fragment, index) => {
        let outputs;
        if (fragment.outputs.length === 1) {
            outputs = getType(fragment.outputs[0]);
        }
        else {
            outputs = `[ ${fragment.outputs.map(getType).join(", ")} ]`;
        }
        let defaultOutput = outputs;
        if (!fragment.constant) {
            defaultOutput = "ethers.ContractTransactionResponse";
        }
        output.push(`  ${fragment.name}: ethers.BaseContractMethod< [ ${fragment.inputs.map(getLooseType).join(", ")} ], ${outputs}, ${defaultOutput} >,`);
    });
    output.push(`}`);
    output.push("");
    output.push(`const ${contract.name}Abi: Array<string> = [`);
    contract.abi.forEachFunction((fragment, index) => {
        output.push(`    ${JSON.stringify(fragment.format("full"))},`);
    });
    output.push(`];`);
    output.push("");
    output.push(`export const ${contract.name} = ethers.BaseContract.buildClass<${contract.name}Interface>(${contract.name}Abi)`);
    return output.join("\n");
}
function zpad(_v, length) {
    let v = String(_v);
    while (v.length < length) {
        v = "0" + v;
    }
    return v;
}
function getTime() {
    const now = new Date();
    let hours = now.getHours(), meridian = "a.m.";
    if (hours >= 12) {
        if (hours > 12) {
            hours -= 12;
        }
        meridian = "p.m.";
    }
    else if (hours === 0) {
        hours = 12;
    }
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    return `${hours}:${zpad(minutes, 2)}:${zpad(seconds, 2)} ${meridian}`;
}
// What was compiled: the content of each source, keyed by its filename. A watcher
// event for an unchanged source (editors emit several events per save, and a save
// can be a no-op) reuses the cached result instead of recompiling and clobbering
// the results that are currently on screen.
const compiledSources = new Map();
function sourceKey(content) {
    return createHash("sha256").update(content).digest("hex");
}
function readSource(inPath, filename) {
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
function isChanged(inPath, filename) {
    const content = readSource(inPath, filename);
    if (content == null) {
        return false;
    }
    const cached = compiledSources.get(filename);
    return (cached == null || cached.key !== sourceKey(content));
}
async function updateDotSol(root, config, filename) {
    const inPath = join(root, config.dirs.contracts);
    const content = readSource(inPath, filename);
    if (content == null) {
        return null;
    }
    const key = sourceKey(content);
    const cached = compiledSources.get(filename);
    if (cached != null && cached.key === key) {
        return cached.compiled;
    }
    const compiled = await compile(inPath, filename, content);
    compiledSources.set(filename, { key, compiled });
    for (const contract of compiled.contracts) {
        const ts = `import { ethers } from "ethers";\n\n` + generateTypeScript(contract);
        const outPath = join(root, config.dirs.output);
        const outFile = parse(filename).name + ".ts";
        fs.mkdirSync(outPath, { recursive: true });
        writeIfChanged(join(outPath, outFile), ts);
    }
    return compiled;
}
// Leaves an up-to-date file alone; rewriting it would bump its mtime and make
// the tsc watcher start a compile for output that did not change
function writeIfChanged(path, content) {
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
function walk(root, path, callback) {
    for (const filename of fs.readdirSync(join(root, path))) {
        if (fs.statSync(join(root, path, filename)).isDirectory()) {
            walk(root, join(path, filename), callback);
        }
        else {
            callback(join(path, filename));
        }
    }
}
function readDir(root) {
    const result = [];
    walk(root, ".", (fn) => { result.push(fn); });
    return result;
}
async function updateDotSols(root, config, filenames) {
    const errors = [];
    for (const filename of filenames) {
        const compiled = await updateDotSol(root, config, filename);
        if (compiled == null) {
            continue;
        }
        compiled.errors.forEach((e) => errors.push(e));
        compiled.warnings.forEach((e) => errors.push(e));
    }
    if (errors.length) {
        errors.forEach((e) => console.log(e.formatted));
    }
    else {
        console.log(`\n${getTime()} - Found 0 errors. Watching for contract changes...\n`);
    }
    return errors;
}
(async function () {
    const config = {
        dirs: {
            contracts: "contracts",
            // Defaults to src.ts/${ dirs.contracts }
            output: "src.ts/contracts",
        }
    };
    // @TODO: Pull this from the project root? where package.json lives? tsconfig?
    const root = resolve(".");
    // Initial compailation
    const filenames = readDir(join(root, config.dirs.contracts)).filter(f => f.match(/\.sol$/));
    let errors = await updateDotSols(root, config, filenames);
    const watcher = fs.watch(join(root, config.dirs.contracts), { recursive: true }, async (eventType, filename) => {
        if (!filename.match(/\.sol$/)) {
            return;
        }
        // The same source compiles to the same output: keep the current results
        if (!isChanged(join(root, config.dirs.contracts), filename)) {
            return;
        }
        console.log(`\n${getTime()} - File change detected. Starting contract compilation...\n`);
        const filenames = new Set([filename]);
        for (const e of errors) {
            filenames.add(e.filename);
        }
        errors = await updateDotSols(root, config, Array.from(filenames));
    });
    // Spawn tsc; @TODO: add config for this
    const tsc = spawn("npx", ["tsc", "--project", "tsconfig.json", "-w"], {
        cwd: root
    });
    tsc.stdout.on("data", (data) => {
        console.log(data.toString().trim() + "\n");
    });
    tsc.stderr.on("data", (data) => {
        console.log("stderr output from tsc:");
        console.log(data.toString());
    });
    tsc.on("error", (error) => {
        console.log("Error from tsc:");
        console.log("ErrorEE", error);
        watcher.close();
        tsc.disconnect();
    });
    tsc.on("close", (code) => {
        console.log(`${getTime()} - tsc closing. Shutting down.`);
        watcher.close();
    });
})();
//# sourceMappingURL=test.js.map