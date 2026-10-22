import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Single-process write chain. Two ingests in one Node process cannot
// clobber the hash index. This is not a lock across processes.
let writeChain = Promise.resolve();

export function dataDir() {
  return process.env.GLAZE_DATA_DIR
    ? path.resolve(process.env.GLAZE_DATA_DIR)
    : path.join(repoRoot, "data");
}

export function newAssetId() {
  return `glz_${randomBytes(8).toString("hex")}`;
}

export function jobPath(id) {
  return path.join(dataDir(), "jobs", `${id}.json`);
}

function hashIndexPath() {
  return path.join(dataDir(), "hash-index.json");
}

function exclusive(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

export async function readJob(id) {
  if (!/^glz_[0-9a-f]+$/.test(id)) return null;
  try {
    const raw = await readFile(jobPath(id), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function findJobIdByHash(hash) {
  try {
    const raw = await readFile(hashIndexPath(), "utf8");
    const index = JSON.parse(raw);
    return index[hash] ?? null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function saveNewJob(job) {
  return exclusive(async () => {
    const existing = await findJobIdByHash(job.contentHash);
    if (existing) {
      const prior = await readJob(existing);
      if (prior) return { job: prior, duplicate: true };
    }

    await writeJsonAtomic(jobPath(job.id), job);

    let index = {};
    try {
      index = JSON.parse(await readFile(hashIndexPath(), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    index[job.contentHash] = job.id;
    await writeJsonAtomic(hashIndexPath(), index);
    return { job, duplicate: false };
  });
}
