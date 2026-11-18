import { readFile, writeFile } from "node:fs/promises";

const target = "node_modules/@opennextjs/aws/dist/build/copyTracedFiles.js";
const source = await readFile(target, "utf8");

const oldBlock = `    if (existsSync(path.join(dotNextDir, MIDDLEWARE_TRACE_FILE))) {
        // We still need to copy the nft.json file so that computeCopyFilesForPage doesn't throw
        copyFileAndMakeOwnerWritable(path.join(dotNextDir, MIDDLEWARE_TRACE_FILE), path.join(standaloneNextDir, MIDDLEWARE_TRACE_FILE));
        computeCopyFilesForPage("middleware");
`;
const newBlock = `    if (existsSync(path.join(dotNextDir, MIDDLEWARE_TRACE_FILE))) {
        // We still need to copy the nft.json file so that computeCopyFilesForPage doesn't throw
        copyFileAndMakeOwnerWritable(path.join(dotNextDir, MIDDLEWARE_TRACE_FILE), path.join(standaloneNextDir, MIDDLEWARE_TRACE_FILE));
        // Next 16 Turbopack builds keep the proxy/middleware bundle in .next/server,
        // but standalone builds do not copy it automatically.
        const middlewareServerFile = path.join("server", "middleware.js");
        if (existsSync(path.join(dotNextDir, middlewareServerFile)) &&
            !existsSync(path.join(standaloneNextDir, middlewareServerFile))) {
            copyFileAndMakeOwnerWritable(path.join(dotNextDir, middlewareServerFile), path.join(standaloneNextDir, middlewareServerFile));
        }
        computeCopyFilesForPage("middleware");
`;

if (!source.includes(oldBlock)) {
  if (!source.includes('const middlewareServerFile = path.join("server", "middleware.js");')) {
    throw new Error("OpenNext copyTracedFiles.js structure changed; middleware compatibility patch was not applied.");
  }
} else {
  await writeFile(target, source.replace(oldBlock, newBlock));
}
