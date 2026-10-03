import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { parseWorld, parseProposal, parseProject } from "./schema.ts";
import { validateWorld } from "./validate.ts";
import type { Condition, Episode, Finding, Operation, World, Proposal, Project, ValidationReport } from "./types.ts";

function episodeIds(episode: Episode): string[] {
  return [episode.id, ...episode.actions.map(a => a.id), ...episode.intro.map(f => f.id), ...episode.fragments.map(f => f.id)];
}
function worldIds(world: World): Set<string> {
  return new Set([
    ...world.entities.map(e => e.id), ...world.predicates.map(p => p.id), ...world.claims.map(c => c.id),
    ...world.assertions.map(a => a.id), ...world.rules.map(r => r.id), ...world.openQuestions.map(q => q.id),
    ...world.episodes.flatMap(episodeIds), ...world.game.variables.map(v => v.id), ...world.game.endings.map(f => f.id),
  ]);
}
function conditionReads(condition: Condition): string[] {
  switch (condition.op) {
    case "true": return [];
    case "all": case "any": return condition.conditions.flatMap(conditionReads);
    case "not": return conditionReads(condition.condition);
    case "knows": return [condition.claimId];
    default: return [condition.variable];
  }
}
function operationWrites(operation: Operation): string[] {
  switch (operation.kind) {
    case "addEntity": return [operation.entity.id];
    case "addClaim": return [operation.claim.id];
    case "addAssertion": return [operation.assertion.id];
    case "addEpisode": return episodeIds(operation.episode);
    case "supersedeAssertion": return [operation.assertionId];
  }
}
function operationReads(operation: Operation, world: World): string[] {
  switch (operation.kind) {
    case "addEntity": return [];
    case "addClaim": return [operation.claim.subjectId, operation.claim.predicateId, ...(operation.claim.value.kind === "entity" ? [operation.claim.value.entityId] : [])];
    case "addAssertion": {
      const layer = operation.assertion.layer;
      const source = operation.assertion.source;
      return [operation.assertion.claimId, ...[source.artifactId, source.authorId].filter(id => !id.startsWith("external:")), ...(layer.kind === "belief" ? [layer.holderId] : layer.kind === "record" ? [layer.documentId] : layer.kind === "hypothesis" ? [layer.proposedById] : [])];
    }
    case "supersedeAssertion": {
      const claimId = world.assertions.find(a => a.id === operation.assertionId)?.claimId;
      return [operation.assertionId, ...(claimId ? [claimId] : [])];
    }
    case "addEpisode": {
      const episode = operation.episode;
      return [
        episode.locationId, ...episode.participants, ...conditionReads(episode.completion),
        ...[...episode.intro, ...episode.fragments].flatMap(f => [...conditionReads(f.condition), ...f.disclosedClaimIds]),
        ...episode.actions.flatMap(a => [...conditionReads(a.condition), ...a.effects.map(e => e.kind === "learn" ? e.claimId : e.variable)]),
      ];
    }
  }
}
function report(findings: Finding[]): ValidationReport {
  return { status: findings.some(f => f.severity === "error") ? "invalid" : findings.length ? "needs-review" : "valid", findings };
}
export class ProposalValidationError extends Error {
  readonly report: ValidationReport;
  constructor(result: ValidationReport) {
    super(`Proposal invalid: ${result.findings.map(f => `${f.code}: ${f.message}`).join("; ")}`);
    this.name = "ProposalValidationError";
    this.report = result;
  }
}

export function previewProposal(inputWorld: World, inputProposal: Proposal): { world: World; report: ValidationReport } {
  let world: World; let proposal: Proposal;
  try { world = parseWorld(inputWorld); proposal = parseProposal(inputProposal); }
  catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return { world: structuredClone(inputWorld), report: report(error.issues.map(issue => ({ code: "schema", severity: "error", path: issue.path.join("."), message: issue.message, relatedIds: [] }))) };
  }
  const findings: Finding[] = [];
  const add = (code: string, path: string, message: string, relatedIds: string[] = []) => { findings.push({ code, severity: "error", path, message, relatedIds }); };
  if (proposal.basedOnRevision !== world.revision) add("stale-revision", "basedOnRevision", `Proposal revision ${proposal.basedOnRevision} does not match ${world.revision}`, [proposal.basedOnRevision, world.revision]);
  if (proposal.operations.length === 0) add("empty-proposal", "operations", "A proposal must contain an operation", [proposal.id]);
  if (proposal.namespace.endsWith(".")) add("proposal-namespace", "namespace", "Namespace cannot end with a dot", [proposal.namespace]);
  const existingIds = worldIds(world);
  const writes = proposal.operations.flatMap(operationWrites);
  const actualWrites = new Set(writes);
  const declaredWrites = new Set(proposal.writeSet);
  if (declaredWrites.size !== proposal.writeSet.length) add("write-set", "writeSet", "writeSet contains duplicates");
  for (const id of actualWrites) if (!declaredWrites.has(id)) add("write-set", "writeSet", `Missing written ID ${id}`, [id]);
  for (const id of declaredWrites) if (!actualWrites.has(id)) add("write-set", "writeSet", `ID ${id} is not written by an operation`, [id]);
  const declaredReads = new Set(proposal.readSet);
  if (declaredReads.size !== proposal.readSet.length) add("read-set", "readSet", "readSet contains duplicates");
  for (const id of declaredReads) if (!existingIds.has(id)) add("read-set", "readSet", `Unknown existing read ID ${id}`, [id]);
  const requiredReads = new Set(proposal.operations.flatMap(op => operationReads(op, world)).filter(id => existingIds.has(id)));
  for (const id of requiredReads) if (!declaredReads.has(id)) add("read-set", "readSet", `Missing existing reference ${id}`, [id]);
  const superseded = new Set<string>();
  for (const [i, operation] of proposal.operations.entries()) {
    if (operation.kind !== "supersedeAssertion") {
      for (const id of operationWrites(operation)) {
        if (!id.startsWith(`${proposal.namespace}.`) || id.length === proposal.namespace.length + 1) add("proposal-namespace", `operations.${i}`, `Added ID ${id} must be within ${proposal.namespace}.`, [id]);
        if (existingIds.has(id)) add("duplicate-id", `operations.${i}`, `Cannot replace existing ID ${id}`, [id]);
      }
    }
    switch (operation.kind) {
      case "addEntity": world.entities.push(operation.entity); break;
      case "addClaim": world.claims.push(operation.claim); break;
      case "addEpisode": world.episodes.push(operation.episode); break;
      case "addAssertion":
        if (operation.assertion.status !== "proposed") add("assertion-status", `operations.${i}.assertion.status`, "New assertions must be proposed until an author commits them", [operation.assertion.id]);
        world.assertions.push(operation.assertion);
        break;
      case "supersedeAssertion": {
        const target = world.assertions.find(a => a.id === operation.assertionId && existingIds.has(a.id));
        if (!target) add("unknown-reference", `operations.${i}.assertionId`, `Unknown existing assertion ${operation.assertionId}`, [operation.assertionId]);
        else if (target.status !== "accepted" || superseded.has(target.id)) add("assertion-status", `operations.${i}.assertionId`, "Only accepted assertions can be superseded once", [target.id]);
        else { target.status = "superseded"; superseded.add(target.id); }
        break;
      }
    }
  }
  findings.push(...validateWorld(world).findings);
  return { world, report: report(findings) };
}

export function commitProposal(inputProject: Project, inputProposal: Proposal, decision: { author: string; reason: string }, now = new Date().toISOString()): Project {
  if (!decision || typeof decision.author !== "string" || typeof decision.reason !== "string" || !decision.author.trim() || !decision.reason.trim()) throw new Error("An author decision with a nonempty author and reason is required");
  const project = parseProject(inputProject);
  const proposal = parseProposal(inputProposal);
  if (project.history.some(record => record.proposalId === proposal.id)) throw new Error(`Proposal ${proposal.id} was already committed; stale or duplicate proposal`);
  const baseReport = validateWorld(project.world);
  if (baseReport.status === "invalid") throw new ProposalValidationError(baseReport);
  const preview = previewProposal(project.world, proposal);
  if (preview.report.status === "invalid") throw new ProposalValidationError(preview.report);
  const addedAssertions = new Set(proposal.operations.flatMap(op => op.kind === "addAssertion" ? [op.assertion.id] : []));
  for (const assertion of preview.world.assertions) if (addedAssertions.has(assertion.id)) assertion.status = "accepted";
  const acceptedReport = validateWorld(preview.world);
  if (acceptedReport.status === "invalid") throw new ProposalValidationError(acceptedReport);
  const revision = `revision.${randomUUID()}`;
  preview.world.revision = revision;
  project.history.push({ id: revision, parent: project.world.revision, proposalId: proposal.id, createdAt: now, decision: { author: decision.author, reason: decision.reason }, proposal });
  project.world = preview.world;
  return parseProject(project);
}
