import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { Edge, Node } from "reactflow";
import type { NodeData } from "../types";

type Snapshot = { 
  nodes: Node<NodeData>[]; 
  edges: Edge[]; 
  selectedNodeIds: string[];
  selectedEdgeIds: string[]
};

type S = {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];

  past: Snapshot[];
  future: Snapshot[];

  confirmDeleteOpen: boolean;
  confirmDeleteCount: number;

  currentFilePath: string | null;
  setCurrentFilePath: (p: string | null) => void;


  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;

  addQuestion: () => void;
  addEnding: () => void;

  requestDelete: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;

  patchNode: (id: string, patch: Partial<NodeData>) => void;

  resetHistory: () => void;
  replaceAll: (nodes: Node<NodeData>[], edges: Edge[]) => void;

  isDirty: boolean;
  lastSavedAt: number | null;
  markDirty: () => void;
  markSaved: () => void;

  isLoadingProject: boolean;
  beginLoad: () => void;
  endLoad: () => void;

  deleteSelectedEdgesNow: () => void;

};

function snap(nodes: Node<NodeData>[], edges: Edge[], selectedNodeIds: string[], selectedEdgeIds: string[]): Snapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    selectedNodeIds: structuredClone(selectedNodeIds),
    selectedEdgeIds: structuredClone(selectedEdgeIds)
  };
}



export const useEditorStore = create<S>()(
  immer((set, get) => ({
    deleteSelectedEdgesNow() {
      const edgeIds = new Set(get().selectedEdgeIds);
      if (edgeIds.size === 0) return;

      get().pushHistory();
      set((s) => {
        s.edges = s.edges.filter((e) => !edgeIds.has(e.id));
        s.selectedEdgeIds = [];
        s.isDirty = true;
        (window as any).branchpro?.setDirty?.(true);
 // если есть dirty
      });
    },



    isLoadingProject: false,

    beginLoad() {
      set({ isLoadingProject: true });
    },

    endLoad() {
      set({ isLoadingProject: false, isDirty: false, lastSavedAt: null });
    },

    isDirty: false,
    lastSavedAt: null,

    markDirty() {
      set({ isDirty: true });
      (window as any).branchpro?.setDirty?.(true);
    },

    markSaved() {
      set({ isDirty: false });
      (window as any).branchpro?.setDirty?.(false);
    },



    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],


    past: [],
    future: [],

    confirmDeleteOpen: false,
    confirmDeleteCount: 0,

    currentFilePath: null,
    setCurrentFilePath(p) {
      set({ currentFilePath: p });
    },


    pushHistory() {
      const { nodes, edges, selectedNodeIds, selectedEdgeIds, past } = get();
      set({ past: [...past, snap(nodes, edges, selectedNodeIds, selectedEdgeIds)], future: [] });
  },


    undo() {
      const { past, future, nodes, edges, selectedNodeIds, selectedEdgeIds } = get();
      if (past.length === 0) return;

      const prev = past[past.length - 1]!;
      const cur = snap(nodes, edges, selectedNodeIds, selectedEdgeIds);

      set({
        past: past.slice(0, -1),
        future: [cur, ...future],
        nodes: prev.nodes,
        edges: prev.edges,
        selectedNodeIds: prev.selectedNodeIds,
        selectedEdgeIds: prev.selectedEdgeIds
      });
    },


    redo() {
      const { past, future, nodes, edges, selectedNodeIds, selectedEdgeIds } = get();
      if (future.length === 0) return;

      const next = future[0]!;
      const cur = snap(nodes, edges, selectedNodeIds, selectedEdgeIds);

      set({
        past: [...past, cur],
        future: future.slice(1),
        nodes: next.nodes,
        edges: next.edges,
        selectedNodeIds: next.selectedNodeIds,
        selectedEdgeIds: next.selectedEdgeIds
      });
    },


    setNodes(nodes) {
      set({ nodes });
    },
    setEdges(edges) {
      set({ edges });
    },

    setSelection(nodeIds, edgeIds) {
      set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
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
        s.isDirty = true;
        (window as any).branchpro?.setDirty?.(true);

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
        s.isDirty = true;
        (window as any).branchpro?.setDirty?.(true);

        s.selectedNodeIds = [id];
      });
    },

    requestDelete() {
      const nodeCount = get().selectedNodeIds.length;
      const edgeCount = get().selectedEdgeIds.length;

      if (nodeCount === 0 && edgeCount === 0) return;

      // ✅ только линии — удаляем сразу, без подтверждения
      if (nodeCount === 0 && edgeCount > 0) {
        get().deleteSelectedEdgesNow();
        return;
      }

      // ✅ есть ноды — подтверждение
      set({ confirmDeleteOpen: true, confirmDeleteCount: nodeCount + edgeCount });
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
        s.isDirty = true;
        (window as any).branchpro?.setDirty?.(true);
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
        s.isDirty = true;
        (window as any).branchpro?.setDirty?.(true);

      });
    },
    resetHistory() {
      set({ past: [], future: [] });
    },

    replaceAll(nodes, edges) {
      set({
        nodes,
        edges,
        selectedNodeIds: [],
       confirmDeleteOpen: false,
        confirmDeleteCount: 0,
        past: [],
        future: [],
        isDirty: false,
        lastSavedAt: null
      });
    },


  }))
);
