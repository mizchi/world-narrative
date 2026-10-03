/** Contracts for the feasibility experiment, not a production world schema. */
export type Consistency = "compatible" | "contradiction" | "underdetermined";
export type Layer = "authorTruth" | "belief" | "record" | "hypothesis";
export type Genre = "dark-fantasy" | "urban-horror" | "hard-sf" | "modern-mystery";

export interface World {
  id: string;
  genre: Genre;
  canon: string[];
  constraints: string[];
  unresolved: string[];
  revealPolicy: string[];
  playerContext: string;
}
export interface Candidate {
  id: string;
  worldId: string;
  layer: Layer;
  holder?: string;
  text: string;
  presentation: string;
  gameplay: string;
}
export interface ReferenceCase {
  candidate: Candidate;
  expected: { consistency: Consistency; hook: boolean; leak: boolean };
  rationale: string;
}
export interface Fixtures { worlds: World[]; cases: ReferenceCase[] }

export type Instructions = string | Record<string, unknown>;
export type Question =
  | { type: "choice"; instructions: Instructions; criteria: Record<string, string> }
  | { type: "noul"; instructions: Instructions; criteria: { true: string; false: string } };
export type Questions = Record<string, Question>;
export type Answer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number };
export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}
export interface Payload { state: { worlds: World[]; candidates: Candidate[] }; questions: Questions }
