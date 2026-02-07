import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { Edge, Node } from "reactflow";
import type { NodeData } from "../types";

type Snapshot = { nodes: Node<NodeData>[]; edges: Edge[]; selectedNodeIds: string[] };

type S = {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeIds: string[];

  past: Snapshot[];
  future: Snapshot[];

  confirmDeleteOpen: boolean;
  confirmDeleteCount: number;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSelection: (ids: string[]) => void;

  addQuestion: () => void;
  addEnding: () => void;

  requestDelete: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;

  patchNode: (id: string, patch: Partial<NodeData>) => void;
};

function snap(nodes: Node<NodeData>[], edges: Edge[], selectedNodeIds: string[]): Snapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    selectedNodeIds: structuredClone(selectedNodeIds)
  };
}

export const useEditorStore = create<S>()(
  immer((set, get) => ({
    nodes: [],
    edges: [],
    selectedNodeIds: [],

    past: [],
    future: [],

    confirmDeleteOpen: false,
    confirmDeleteCount: 0,

    pushHistory() {
      const { nodes, edges, selectedNodeIds, past } = get();
      set({ past: [...past, snap(nodes, edges, selectedNodeIds)], future: [] });
    },

    undo() {
      const { past, future, nodes, edges, selectedNodeIds } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1]!;
      const cur = snap(nodes, edges, selectedNodeIds);
      set({
        past: past.slice(0, -1),
        future: [cur, ...future],
        nodes: prev.nodes,
        edges: prev.edges,
        selectedNodeIds: prev.selectedNodeIds
      });
    },

    redo() {
      const { past, future, nodes, edges, selectedNodeIds } = get();
      if (future.length === 0) return;
      const next = future[0]!;
      const cur = snap(nodes, edges, selectedNodeIds);
      set({
        past: [...past, cur],
        future: future.slice(1),
        nodes: next.nodes,
        edges: next.edges,
        selectedNodeIds: next.selectedNodeIds
      });
    },

    setNodes(nodes) {
      set({ nodes });
    },
    setEdges(edges) {
      set({ edges });
    },
    setSelection(ids) {
      set({ selectedNodeIds: ids });
    },

    addQuestion() {
      get().pushHistory();
      const id = nanoid();

      set((s) => {
        s.nodes.push({
          id,
          type: "questionNode",
          position: { x: 200 + Math.random() * 200, y: 140 + Math.random() * 200 },
          data: {
            kind: "question",
            title: "Вопрос",
            answers: [
              { id: nanoid(), text: "Ответ 1" },
              { id: nanoid(), text: "Ответ 2" }
            ],
            mediaList: [],
            mediaIndex: 0
          } as any
        });

        s.selectedNodeIds = [id];
      });
    },

    addEnding() {
      get().pushHistory();
      const id = nanoid();

      set((s) => {
        s.nodes.push({
          id,
          type: "endingNode",
          position: { x: 260 + Math.random() * 220, y: 160 + Math.random() * 220 },
          data: {
            kind: "ending",
            title: "Концовка",
            resultText: "Итог/решение...",
            mediaList: [],
            mediaIndex: 0
          } as any
        });

        s.selectedNodeIds = [id];
      });
    },

    requestDelete() {
      const n = get().selectedNodeIds.length;
      if (n === 0) return;
      set({ confirmDeleteOpen: true, confirmDeleteCount: n });
    },

    confirmDelete() {
      const ids = new Set(get().selectedNodeIds);
      if (ids.size === 0) return;

      get().pushHistory();
      set((s) => {
        s.nodes = s.nodes.filter((n) => !ids.has(n.id));
        s.edges = s.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
        s.selectedNodeIds = [];
        s.confirmDeleteOpen = false;
        s.confirmDeleteCount = 0;
      });
    },

    cancelDelete() {
      set({ confirmDeleteOpen: false, confirmDeleteCount: 0 });
    },

    patchNode(id, patch) {
      get().pushHistory();
      set((s) => {
        const n = s.nodes.find((x) => x.id === id);
        if (!n) return;
        n.data = { ...(n.data as any), ...(patch as any) };
      });
    }
  }))
);
