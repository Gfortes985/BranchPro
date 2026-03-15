import type { Edge, Node } from "reactflow";
import type { NodeData } from "../types";

export type ValidationLevel = "error" | "warning";

export type ValidationIssue = {
  level: ValidationLevel;
  code: string;
  message: string;
  nodeId?: string;
};

export function validateProject(nodes: Node<NodeData>[], edges: Edge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (nodes.length === 0) {
    issues.push({
      level: "warning",
      code: "EMPTY_PROJECT",
      message: "Проект пустой — добавь хотя бы один вопрос и одну концовку."
    });
    return issues;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const n of nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  }

  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) {
      issues.push({
        level: "error",
        code: "BROKEN_EDGE",
        message: `Связь ${e.id ?? "(без id)"} указывает на несуществующую ноду.`
      });
      continue;
    }

    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const questionNodes = nodes.filter((n) => (n.data as any)?.kind === "question");
  const endingNodes = nodes.filter((n) => (n.data as any)?.kind === "ending");
  const entryNodes = questionNodes.filter((n) => Boolean((n.data as any)?.isEntry));

  if (entryNodes.length === 0) {
    issues.push({
      level: "error",
      code: "NO_ENTRY",
      message: "Нет входного вопроса. Отметь один вопрос как стартовый (Входной блок)."
    });
  }

  if (entryNodes.length > 1) {
    issues.push({
      level: "error",
      code: "MULTIPLE_ENTRIES",
      message: `Найдено несколько стартовых вопросов (${entryNodes.length}). Оставь только один.`
    });
  }

  if (endingNodes.length === 0) {
    issues.push({
      level: "warning",
      code: "NO_ENDINGS",
      message: "В проекте нет концовок. Добавь хотя бы одну ноду типа Ending."
    });
  }

  for (const q of questionNodes) {
    const answers = ((q.data as any)?.answers ?? []) as Array<{ id: string; text: string }>;

    if (answers.length === 0) {
      issues.push({
        level: "error",
        code: "QUESTION_WITHOUT_ANSWERS",
        message: `Вопрос "${(q.data as any)?.title ?? q.id}" не содержит ответов.`,
        nodeId: q.id
      });
    }

    for (const answer of answers) {
      const handleId = `ans:${answer.id}`;
      const hasBranch = edges.some((e) => e.source === q.id && (e.sourceHandle ?? "") === handleId);
      if (!hasBranch) {
        issues.push({
          level: "warning",
          code: "UNLINKED_ANSWER",
          message: `У ответа "${answer.text || "(без текста)"}" нет перехода в следующую ноду.`,
          nodeId: q.id
        });
      }
    }
  }

  const roots = entryNodes.length > 0
    ? entryNodes.map((n) => n.id)
    : nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);

  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);

    for (const e of edges) {
      if (e.source === id && !reachable.has(e.target)) queue.push(e.target);
    }
  }

  for (const n of nodes) {
    if (!reachable.has(n.id)) {
      issues.push({
        level: "warning",
        code: "UNREACHABLE_NODE",
        message: `Нода "${(n.data as any)?.title ?? n.id}" недостижима из стартовой точки.`,
        nodeId: n.id
      });
    }
  }

  return issues;
}

