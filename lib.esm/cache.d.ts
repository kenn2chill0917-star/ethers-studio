import type { Compiled } from "./solidity.js";
export interface CacheEntry {
    key: string;
    compiled: Compiled;
}
export declare function sourceKey(content: string): string;
export declare function getCached(filename: string): null | CacheEntry;
export declare function setCached(filename: string, key: string, compiled: Compiled): void;
export declare function clearCache(): void;
export declare function readSource(inPath: string, filename: string): null | string;
export declare function isChanged(inPath: string, filename: string): boolean;
export declare function writeIfChanged(path: string, content: string): void;
//# sourceMappingURL=cache.d.ts.map