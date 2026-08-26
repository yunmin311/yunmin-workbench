/*
 * Adapted from DeepSeek-Reasonix desktop/frontend-next/src/ui/glayout.ts
 * tag studio-v2.7.0, commit 9b7a573ac3a94b0a2313480181374464978e5ae9.
 * MIT License, Copyright (c) 2026 Reasonix Contributors.
 *
 * The donor's deterministic rank geometry and median crossing-minimisation are
 * retained. Kernel graph types, context-delivery folding, and edge semantics
 * are intentionally not copied: Yunmin's existing Projection Truth remains the
 * only source of nodes and edges.
 */
import type { WbEdge, WbNode } from '../../../core/types';

const W = 216;
const H = 64;
const COL_GAP = 116;
const ROW_GAP = 26;
const ROUNDS = 4;

function ranksOf(nodes: WbNode[], edges: WbEdge[]): WbNode[][] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const pairs = new Set<string>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    if (pairs.has(key)) continue;
    pairs.add(key);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const rank = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) rank.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const to of outgoing.get(from) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(from) ?? 0) + 1));
      incoming.set(to, (incoming.get(to) ?? 1) - 1);
      if (incoming.get(to) === 0) queue.push(to);
    }
  }

  // Projection graphs should be acyclic. If an upstream fact ever violates
  // that, keep every node visible without inventing a direction for the cycle.
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);
  const count = Math.max(0, ...rank.values()) + 1;
  const columns = Array.from({ length: count }, () => [] as WbNode[]);
  for (const node of nodes) columns[rank.get(node.id) ?? 0].push(node);
  return columns;
}

function minimizeCrossings(columns: WbNode[][], edges: WbEdge[]): WbNode[][] {
  const steps = edges.map((edge) => [edge.source, edge.target] as const);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const [a, b] of steps) {
    down.set(a, [...(down.get(a) ?? []), b]);
    up.set(b, [...(up.get(b) ?? []), a]);
  }
  let best = columns.map((column) => column.slice());
  let cheapest = crossings(best, steps);
  const current = columns.map((column) => column.slice());
  for (let round = 0; round < ROUNDS && cheapest > 0; round++) {
    sweep(current, up, 1);
    sweep(current, down, -1);
    const cost = crossings(current, steps);
    if (cost < cheapest) {
      cheapest = cost;
      best = current.map((column) => column.slice());
    }
  }
  return best;
}

function sweep(columns: WbNode[][], neighbours: Map<string, string[]>, direction: 1 | -1): void {
  const first = direction === 1 ? 1 : columns.length - 2;
  const last = direction === 1 ? columns.length : -1;
  for (let index = first; index !== last; index += direction) {
    const fixed = new Map(columns[index - direction].map((node, row) => [node.id, row] as const));
    const key = new Map(columns[index].map((node, row) => [node.id, median(neighbours.get(node.id), fixed, row)] as const));
    columns[index] = columns[index].slice().sort((a, b) => (key.get(a.id) ?? 0) - (key.get(b.id) ?? 0));
  }
}

function median(ids: string[] | undefined, fixed: Map<string, number>, fallback: number): number {
  const rows = (ids ?? [])
    .map((id) => fixed.get(id))
    .filter((row): row is number => row !== undefined)
    .sort((a, b) => a - b);
  if (rows.length === 0) return fallback;
  const middle = rows.length >> 1;
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function crossings(columns: WbNode[][], steps: readonly (readonly [string, string])[]): number {
  let total = 0;
  for (let index = 0; index + 1 < columns.length; index++) {
    const left = new Map(columns[index].map((node, row) => [node.id, row] as const));
    const right = new Map(columns[index + 1].map((node, row) => [node.id, row] as const));
    const spans: [number, number][] = [];
    for (const [a, b] of steps) {
      const from = left.get(a);
      const to = right.get(b);
      if (from !== undefined && to !== undefined) spans.push([from, to]);
    }
    for (let a = 0; a < spans.length; a++) {
      for (let b = a + 1; b < spans.length; b++) {
        if ((spans[a][0] - spans[b][0]) * (spans[a][1] - spans[b][1]) < 0) total++;
      }
    }
  }
  return total;
}

export function layoutProjection(nodes: WbNode[], edges: WbEdge[]): WbNode[] {
  const columns = minimizeCrossings(ranksOf(nodes, edges), edges);
  const tallest = Math.max(H, ...columns.map((column) => column.length * H + Math.max(0, column.length - 1) * ROW_GAP));
  const placed = new Map<string, { x: number; y: number }>();

  columns.forEach((column, rank) => {
    const height = column.length * H + Math.max(0, column.length - 1) * ROW_GAP;
    let y = (tallest - height) / 2;
    for (const node of column) {
      placed.set(node.id, { x: rank * (W + COL_GAP), y });
      y += H + ROW_GAP;
    }
  });

  return nodes.map((node) => ({ ...node, ...(placed.get(node.id) ?? { x: 0, y: 0 }) }));
}
