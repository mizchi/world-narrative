import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { FORMAT_VERSION, type World, type Project } from "./types.ts";
import { parseProject, parseWorld } from "./schema.ts";
import { validateWorld } from "./validate.ts";
import { previewProposal } from "./proposal.ts";

export class ProjectConflictError extends Error {
  constructor(message: string) { super(`Project conflict: ${message}`); this.name = "ProjectConflictError"; }
}
function hasCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
function validated(project: Project): Project {
  const parsed = parseProject(project);
  const report = validateWorld(parsed.world);
  if (report.status === "invalid") throw new Error(`Cannot store invalid world: ${report.findings.map(f => f.code).join(", ")}`);
  const seen = new Set<string>();
  for (const [i, record] of parsed.history.entries()) {
    if (seen.has(record.id) || record.id === record.parent || record.proposalId !== record.proposal.id || record.proposal.basedOnRevision !== record.parent || (i > 0 && parsed.history[i - 1]!.id !== record.parent)) throw new Error("Invalid project revision history");
    seen.add(record.id);
  }
  if (parsed.history.length && parsed.history.at(-1)!.id !== parsed.world.revision) throw new Error("World revision does not match project history");
  return parsed;
}
async function locked<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const lockPath = join(directory, ".project.lock");
  try { await mkdir(lockPath); }
  catch (error) { if (hasCode(error, "EEXIST")) throw new ProjectConflictError("another writer holds the project lock"); throw error; }
  try { return await work(); }
  finally { await rm(lockPath, { recursive: true, force: true }); }
}
async function atomicWrite(directory: string, project: Project): Promise<void> {
  const temporary = join(directory, `.project.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, join(directory, "project.json"));
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally { if (handle) await handle.close(); await rm(temporary, { force: true }); }
}

export async function createProject(directory: string, world: World): Promise<Project> {
  const project = validated({ formatVersion: FORMAT_VERSION, world: parseWorld(world), history: [] });
  await mkdir(directory, { recursive: true });
  return locked(directory, async () => {
    try { await lstat(join(directory, "project.json")); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; await atomicWrite(directory, project); return project; }
    throw new Error("Project already initialized; project.json exists");
  });
}
export async function loadProject(directory: string): Promise<Project> {
  return validated(parseProject(JSON.parse(await readFile(join(directory, "project.json"), "utf8"))));
}
export async function saveProject(directory: string, inputProject: Project, expectedRevision: string): Promise<void> {
  const project = validated(inputProject);
  await locked(directory, async () => {
    const existing = await loadProject(directory);
    if (existing.world.revision !== expectedRevision) throw new ProjectConflictError(`expected revision ${expectedRevision}, found ${existing.world.revision}`);
    if (project.world.id !== existing.world.id) throw new ProjectConflictError("cannot replace a project with another world");
    if (project.world.revision === existing.world.revision) {
      if (JSON.stringify(project) !== JSON.stringify(existing)) throw new ProjectConflictError("cannot change canon without a new revision and history record");
      return;
    }
    if (project.history.length !== existing.history.length + 1 || JSON.stringify(project.history.slice(0, -1)) !== JSON.stringify(existing.history) || project.history.at(-1)?.parent !== expectedRevision) throw new ProjectConflictError("save must append one author decision to the existing revision history");
    const last = project.history.at(-1)!;
    const replay = previewProposal(existing.world, last.proposal);
    if (replay.report.status === "invalid") throw new ProjectConflictError("recorded proposal is invalid against the saved canon");
    const added = new Set(last.proposal.operations.flatMap(op => op.kind === "addAssertion" ? [op.assertion.id] : []));
    for (const assertion of replay.world.assertions) if (added.has(assertion.id)) assertion.status = "accepted";
    replay.world.revision = project.world.revision;
    if (JSON.stringify(replay.world) !== JSON.stringify(project.world)) throw new ProjectConflictError("world contains canon edits outside the declared proposal");
    await atomicWrite(directory, project);
  });
}
