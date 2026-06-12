export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type Persona = "engineer" | "builder";

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

export interface FuncInfo {
  name: string;
  startLine: number;
  endLine: number;
}

export interface FlowFileNode {
  id: string;
  name: string;
  dir: string;
  lang: string;
  functions: FuncInfo[];
  loc: number;
  role: string;
  purpose: string;
  ai: boolean;
  inlet: boolean;
  outlet: boolean;
  uses: number;
  usedBy: number;
}

export interface FlowFileEdge {
  from: string;
  to: string;
  fromFn?: string;
  toFn?: string;
  kind: "call" | "import";
}

export interface FlowGraph {
  nodes: FlowFileNode[];
  edges: FlowFileEdge[];
  truncated: boolean;
}

export interface FeatureStep {
  file: string;
  fn?: string | null;
  does: string;
  example: string;
}

export interface Feature {
  name: string;
  description: string;
  files: string[];
  flow: FeatureStep[];
}
