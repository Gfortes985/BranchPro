export type Answer = {
  id: string;
  text: string;
};

export type MediaRef = {
  type: "image" | "video";
  path: string;
};

export type QuestionNodeData = {
  kind: "question";
  title: string;
  answers: Answer[];
  mediaList?: MediaRef[];
};

export type EndingNodeData = {
  kind: "ending";
  title: string;
  resultText: string;
  mediaList?: MediaRef[];
};

export type NodeData = QuestionNodeData | EndingNodeData;

export type Node = {
  id: string;
  type: "questionNode" | "endingNode";
  data: NodeData;
};

export type Edge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type Project = {
  nodes: Node[];
  edges: Edge[];
  graph: {
    startNodeIds: string[];
    endNodeIds: string[];
  };
};
