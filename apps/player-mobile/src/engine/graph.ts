import { Project, Node } from "../types";

export function buildIndex(project: Project) {
  const nodeById = new Map<string, Node>();
  project.nodes.forEach(n => nodeById.set(n.id, n));

  return {
    nodeById,

    getStartNode(): Node {
      const id = project.graph.startNodeIds[0];
      return nodeById.get(id)!;
    },

    getNextNode(current: Node, answerId?: string): Node | null {
      if (current.data.kind === "ending") return null;

      const edge = project.edges.find(
        e =>
          e.source === current.id &&
          e.sourceHandle === `ans:${answerId}`
      );

      if (!edge) return null;
      return nodeById.get(edge.target)!;
    }
  };
}
