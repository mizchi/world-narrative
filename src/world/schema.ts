import { z } from "zod";
import { FORMAT_VERSION, type Condition, type World, type Proposal, type Project } from "./types.ts";

const id = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const nonblank = z.string().regex(/\S/);
const integer = z.number().int();
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const entityKind = z.enum(["era", "place", "person", "animal", "anomaly", "event", "organization", "country", "item", "episode", "rule", "technology"]);
const entity = z.strictObject({ id, kind: entityKind, name: nonblank, description: z.string(), gameRole: z.enum(["background", "interactive"]) });
const value = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), entityId: id }),
  z.strictObject({ kind: z.literal("text"), value: z.string() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("quantity"), value: z.number(), unit: nonblank }),
]);
const predicateFields = { id, valueKind: z.enum(["entity", "text", "boolean", "quantity"]), subjectKinds: z.array(entityKind), cardinality: z.enum(["one", "many"]) };
const predicate = z.union([z.strictObject(predicateFields), z.strictObject({ ...predicateFields, unit: nonblank })]);
const scope = z.strictObject({ branchId: id, time: z.union([z.literal("atemporal"), z.strictObject({ start: integer, endExclusive: integer })]), conditionId: id });
const claim = z.strictObject({ id, subjectId: id, predicateId: id, value, scope, text: z.string() });
const layer = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("authorTruth"), polarity: z.enum(["assert", "deny"]) }),
  z.strictObject({ kind: z.literal("belief"), holderId: id, polarity: z.enum(["believes", "disbelieves"]) }),
  z.strictObject({ kind: z.literal("record"), documentId: id }),
  z.strictObject({ kind: z.literal("hypothesis"), proposedById: id }),
]);
const assertion = z.strictObject({ id, claimId: id, layer, status: z.enum(["proposed", "accepted", "superseded"]), source: z.strictObject({ artifactId: nonblank, locator: nonblank, authorId: nonblank }) });
const condition: z.ZodType<Condition> = z.lazy(() => z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("true") }),
  z.strictObject({ op: z.enum(["all", "any"]), conditions: z.array(condition) }),
  z.strictObject({ op: z.literal("not"), condition }),
  z.strictObject({ op: z.literal("eq"), variable: id, value: scalar }),
  z.strictObject({ op: z.enum(["gte", "lte"]), variable: id, value: z.number() }),
  z.strictObject({ op: z.literal("knows"), claimId: id }),
]));
const variable = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("number"), initial: integer, minimum: integer, maximum: integer }),
  z.strictObject({ id, kind: z.literal("boolean"), initial: z.boolean() }),
  z.strictObject({ id, kind: z.literal("enum"), initial: z.string(), values: z.array(z.string()) }),
]);
const effect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("set"), variable: id, value: scalar }),
  z.strictObject({ kind: z.literal("add"), variable: id, amount: integer }),
  z.strictObject({ kind: z.literal("learn"), claimId: id, mode: z.enum(["observed", "believed", "known"]) }),
]);
const rule = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("forbidTruth"), subjectId: id, predicateId: id, value, text: z.string() }),
  z.strictObject({ id, kind: z.literal("reveal"), claimId: id, condition, text: z.string() }),
]);
const fragment = z.strictObject({ id, condition, text: z.string(), disclosedClaimIds: z.array(id) });
const action = z.strictObject({ id, label: nonblank, text: z.string(), condition, costHours: integer.nonnegative(), effects: z.array(effect) });
const episode = z.strictObject({ id, title: nonblank, locationId: id, participants: z.array(id), intro: z.array(fragment), actions: z.array(action), fragments: z.array(fragment), completion: condition });
const game = z.strictObject({ startLocationId: id, deadlineHours: integer.positive(), variables: z.array(variable), locations: z.array(z.strictObject({ entityId: id, description: z.string() })), routes: z.array(z.strictObject({ from: id, to: id, hours: integer.positive() })), endings: z.array(fragment) });
const worldSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION), id, revision: id, title: nonblank,
  contract: z.strictObject({ genre: z.enum(["dark-fantasy", "urban-horror", "hard-sf", "modern-mystery"]), promise: nonblank, verbs: z.array(nonblank), branches: z.array(id) }),
  entities: z.array(entity), predicates: z.array(predicate), claims: z.array(claim), assertions: z.array(assertion), rules: z.array(rule),
  openQuestions: z.array(z.strictObject({ id, text: z.string(), subjectId: id, predicateId: id })), episodes: z.array(episode), game,
});
const operation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("addEntity"), entity }), z.strictObject({ kind: z.literal("addClaim"), claim }),
  z.strictObject({ kind: z.literal("addAssertion"), assertion }), z.strictObject({ kind: z.literal("addEpisode"), episode }),
  z.strictObject({ kind: z.literal("supersedeAssertion"), assertionId: id }),
]);
const proposalSchema = z.strictObject({ formatVersion: z.literal(FORMAT_VERSION), id, basedOnRevision: id, namespace: id, readSet: z.array(id), writeSet: z.array(id), operations: z.array(operation), notes: z.string() });
const decision = z.strictObject({ author: nonblank, reason: nonblank });
const projectSchema = z.strictObject({ formatVersion: z.literal(FORMAT_VERSION), world: worldSchema, history: z.array(z.strictObject({ id, parent: id, proposalId: id, createdAt: z.iso.datetime(), decision, proposal: proposalSchema })) });

export function parseWorld(input: unknown): World { return worldSchema.parse(input); }
export function parseProposal(input: unknown): Proposal { return proposalSchema.parse(input); }
export function parseProject(input: unknown): Project { return projectSchema.parse(input); }
export function jsonSchemas(): { world: unknown; proposal: unknown; project: unknown } {
  return { world: z.toJSONSchema(worldSchema), proposal: z.toJSONSchema(proposalSchema), project: z.toJSONSchema(projectSchema) };
}
