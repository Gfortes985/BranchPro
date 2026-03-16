export type MediaRef = { type: "image" | "video"; path: string };

export type Answer = {
  id: string;
  text: string;
};

export type NodeData =
  | {
      kind: "question";
      title: string;
      answers: Answer[];
      tags?: string[];
      mediaList?: MediaRef[];
      mediaIndex?: number;
    }
  | {
      kind: "ending";
      title: string;
      resultText: string; // текст решения/итога
      tags?: string[];
      mediaList?: MediaRef[];
      mediaIndex?: number;
    };

export type NodeTypeKey = "questionNode" | "endingNode";
