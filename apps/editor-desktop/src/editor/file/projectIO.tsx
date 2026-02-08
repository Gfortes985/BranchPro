import type { Edge, Node } from "reactflow";
import type { NodeData } from "../types";

export type BranchProProject = {
  meta: {
    format: "branchpro";
    version: 1;
    savedAt: string;
  };
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: NodeData;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  graph?: {
    startNodeIds: string[];
    endNodeIds: string[];
  };
};

export function computeGraph(nodes: Node<NodeData>[], edges: Edge[]) {
  const hasIncoming = new Set<string>();
  for (const e of edges) hasIncoming.add(e.target);

  const startNodeIds = nodes
    .filter((n) => !hasIncoming.has(n.id))
    .map((n) => n.id);

  const endNodeIds = nodes
    .filter((n) => (n.data as any)?.kind === "ending")
    .map((n) => n.id);

  return { startNodeIds, endNodeIds };
}

export function toProject(nodes: Node<NodeData>[], edges: Edge[]): BranchProProject {
  const graph = computeGraph(nodes, edges);

  return {
    meta: {
      format: "branchpro",
      version: 1,
      savedAt: new Date().toISOString()
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null
    })),
    graph
  };
}

export function fromProject(p: BranchProProject): { nodes: Node<NodeData>[]; edges: Edge[] } {
  if (!p?.meta || p.meta.format !== "branchpro") {
    throw new Error("Это не BranchPro файл.");
  }
  if (p.meta.version !== 1) {
    throw new Error(`Неподдерживаемая версия формата: ${p.meta.version}`);
  }

  const nodes: Node<NodeData>[] = (p.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type ?? "questionNode",
    position: n.position ?? { x: 0, y: 0 },
    data: n.data as any
  }));

  const edges: Edge[] = (p.edges ?? []).map((e, i) => ({
    id: e.id ?? `e:${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined
  }));

  return { nodes, edges };
}

export type MediaFile = {
  name: string;       // media/xxx.png
  buffer: Uint8Array; // бинарные данные
};

export async function collectProjectWithMedia(
  nodes: any[],
  edges: any[]
): Promise<{ project: BranchProProject; media: MediaFile[] }> {
  const project = toProject(nodes, edges);

  const mediaMap = new Map<string, MediaFile>();

  for (const n of nodes) {
    const list = (n.data as any)?.mediaList ?? [];
    for (const m of list) {
      const filename = `media/${basename(m.path)}`;
      if (mediaMap.has(filename)) continue;

      const buffer = await window.branchpro.readFile(m.path);
      mediaMap.set(filename, {
        name: filename,
        buffer: new Uint8Array(buffer)
      });

      // 🔁 заменяем путь на относительный
      m.path = filename;
    }
  }

  return { project, media: [...mediaMap.values()] };
}

export async function collectBundle(nodes: any[], edges: any[]) {
  // ✅ делаем проект из КОПИИ (toProject и так копирует data ссылкой),
  // поэтому вручную сделаем глубокую копию nodes для project, чтобы можно было менять пути.
  const project = toProject(
    nodes.map((n: any) => ({
      ...n,
      data: structuredClone(n.data) // ✅ копируем data, чтобы можно было править mediaList
    })),
    edges
  );

  const mediaMap = new Map<string, Uint8Array>();

  // ✅ теперь безопасно меняем p.nodes[*].data.mediaList
  for (const pn of project.nodes) {
    const list = (pn.data as any)?.mediaList ?? [];
    for (const m of list) {
      const base = basename(m.path);
      const relName = `media/${base}`;

      if (!mediaMap.has(relName)) {
        // m.path здесь всё ещё исходный (скорее всего абсолютный)
        const buf = await window.branchpro.readFile(m.path);
        mediaMap.set(relName, new Uint8Array(buf));
      }

      // ✅ меняем путь ТОЛЬКО в копии проекта
      m.path = relName;
    }
  }

  const media = [...mediaMap.entries()].map(([name, buffer]) => ({ name, buffer }));
  return { project, media };
}

function basename(p: string) {
  return String(p).split(/[\\/]/).pop() ?? p;
}
