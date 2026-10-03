/** Frozen MVP contract v1. Change this file only through the root integrator. */
export const FORMAT_VERSION = "world-narrative/v1" as const;
export type EntityKind = "era" | "place" | "person" | "animal" | "anomaly" | "event" | "organization" | "country" | "item" | "episode" | "rule" | "technology";
export type Scalar = string | number | boolean;
export interface Entity { id: string; kind: EntityKind; name: string; description: string; gameRole: "background" | "interactive" }
export type Value =
  | { kind: "entity"; entityId: string }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "quantity"; value: number; unit: string };
export interface Predicate { id: string; valueKind: Value["kind"]; subjectKinds: EntityKind[]; cardinality: "one" | "many"; unit?: string }
export interface Scope { branchId: string; time: "atemporal" | { start: number; endExclusive: number }; conditionId: string }
export interface Claim { id: string; subjectId: string; predicateId: string; value: Value; scope: Scope; text: string }
export type AssertionLayer =
  | { kind: "authorTruth"; polarity: "assert" | "deny" }
  | { kind: "belief"; holderId: string; polarity: "believes" | "disbelieves" }
  | { kind: "record"; documentId: string }
  | { kind: "hypothesis"; proposedById: string };
export interface Assertion { id: string; claimId: string; layer: AssertionLayer; status: "proposed" | "accepted" | "superseded"; source: { artifactId: string; locator: string; authorId: string } }
export interface OpenQuestion { id: string; text: string; subjectId: string; predicateId: string }
export type Condition =
  | { op: "true" }
  | { op: "all" | "any"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | { op: "eq"; variable: string; value: Scalar }
  | { op: "gte" | "lte"; variable: string; value: number }
  | { op: "knows"; claimId: string };
export type Variable =
  | { id: string; kind: "number"; initial: number; minimum: number; maximum: number }
  | { id: string; kind: "boolean"; initial: boolean }
  | { id: string; kind: "enum"; initial: string; values: string[] };
export type Effect =
  | { kind: "set"; variable: string; value: Scalar }
  | { kind: "add"; variable: string; amount: number }
  | { kind: "learn"; claimId: string; mode: "observed" | "believed" | "known" };
export type Rule =
  | { id: string; kind: "forbidTruth"; subjectId: string; predicateId: string; value: Value; text: string }
  | { id: string; kind: "reveal"; claimId: string; condition: Condition; text: string };
export interface Fragment { id: string; condition: Condition; text: string; disclosedClaimIds: string[] }
export interface Action { id: string; label: string; text: string; condition: Condition; costHours: number; effects: Effect[] }
export interface Episode { id: string; title: string; locationId: string; participants: string[]; intro: Fragment[]; actions: Action[]; fragments: Fragment[]; completion: Condition }
export interface Location { entityId: string; description: string }
export interface Route { from: string; to: string; hours: number }
export interface GameDefinition { startLocationId: string; deadlineHours: number; variables: Variable[]; locations: Location[]; routes: Route[]; endings: Fragment[] }
export interface World {
  formatVersion: typeof FORMAT_VERSION;
  id: string; revision: string; title: string;
  contract: { genre: "dark-fantasy" | "urban-horror" | "hard-sf" | "modern-mystery"; promise: string; verbs: string[]; branches: string[] };
  entities: Entity[]; predicates: Predicate[]; claims: Claim[]; assertions: Assertion[]; rules: Rule[]; openQuestions: OpenQuestion[]; episodes: Episode[]; game: GameDefinition;
}
export type Operation =
  | { kind: "addEntity"; entity: Entity }
  | { kind: "addClaim"; claim: Claim }
  | { kind: "addAssertion"; assertion: Assertion }
  | { kind: "addEpisode"; episode: Episode }
  | { kind: "supersedeAssertion"; assertionId: string };
export interface Proposal { formatVersion: typeof FORMAT_VERSION; id: string; basedOnRevision: string; namespace: string; readSet: string[]; writeSet: string[]; operations: Operation[]; notes: string }
export interface Finding { code: string; severity: "error" | "review"; path: string; message: string; relatedIds: string[] }
export interface ValidationReport { status: "valid" | "invalid" | "needs-review"; findings: Finding[] }
export interface RevisionRecord { id: string; parent: string; proposalId: string; createdAt: string; decision: { author: string; reason: string }; proposal: Proposal }
export interface Project { formatVersion: typeof FORMAT_VERSION; world: World; history: RevisionRecord[] }
/** Player-safe export: author claims, beliefs, source notes and open questions are omitted. */
export interface GameArtifact { formatVersion: typeof FORMAT_VERSION; worldId: string; revision: string; title: string; promise: string; game: GameDefinition; episodes: Episode[]; revealRules: Extract<Rule, { kind: "reveal" }>[] }
export interface GameState { locationId: string; elapsedHours: number; variables: Record<string, Scalar>; knowledge: Record<string, "observed" | "believed" | "known">; completedActions: string[]; log: string[]; ended: boolean }
export interface ReachabilityReport { status: "complete" | "limit-reached"; visitedStates: number; unreachableActions: string[]; unreachableEpisodes: string[]; terminalStates: number; findings: Finding[] }
