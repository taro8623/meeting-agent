import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ProcessModel,
  Step,
  Edge,
  OpenQuestion,
  ConflictingStatement,
  emptyProcessModel,
} from "../schema/processModel.js";

// ============================================================
// Mock応答が Zod superRefine を通過することを検証
// ============================================================
// 目的: chunk_001 → chunk_002 → chunk_003 の順に Mockパッチを適用した
//       最終 ProcessModel が Zod制約を全て満たすことを保証する。
//       (LLMは呼ばず、事前定義済みパッチだけで完結)

interface MockResponse {
  toolName: string;
  patches: Patch[];
}

type Patch =
  | { op: "add_step"; step: Step }
  | { op: "update_step"; id: string; changes: Partial<Step> }
  | { op: "add_edge"; edge: Edge }
  | { op: "add_question"; question: OpenQuestion }
  | { op: "resolve_question"; id: string; answer: string }
  | { op: "flag_conflict"; questionId: string; statements: ConflictingStatement[] };

interface MockResponsesFile {
  chunk_001: MockResponse;
  chunk_002: MockResponse;
  chunk_003: MockResponse;
  [key: string]: unknown;
}

// パッチ適用ロジック (簡易版・後で src/session/agent.ts でも使う)
function applyPatches(
  model: ProcessModel,
  patches: Patch[]
): ProcessModel {
  const next: ProcessModel = {
    ...model,
    steps: [...model.steps],
    edges: [...model.edges],
    openQuestions: [...model.openQuestions],
    updatedAt: new Date().toISOString(),
  };

  for (const patch of patches) {
    switch (patch.op) {
      case "add_step":
        next.steps.push(patch.step);
        break;
      case "update_step": {
        const idx = next.steps.findIndex((s) => s.id === patch.id);
        if (idx === -1) throw new Error(`Step ${patch.id} not found`);
        next.steps[idx] = { ...next.steps[idx]!, ...patch.changes };
        break;
      }
      case "add_edge":
        next.edges.push(patch.edge);
        break;
      case "add_question":
        next.openQuestions.push(patch.question);
        break;
      case "resolve_question": {
        const idx = next.openQuestions.findIndex((q) => q.id === patch.id);
        if (idx === -1) throw new Error(`Question ${patch.id} not found`);
        next.openQuestions[idx] = {
          ...next.openQuestions[idx]!,
          status: "answered",
          answer: patch.answer,
          answeredAt: new Date().toISOString(),
        };
        break;
      }
      case "flag_conflict": {
        const idx = next.openQuestions.findIndex(
          (q) => q.id === patch.questionId
        );
        if (idx === -1) throw new Error(`Question ${patch.questionId} not found`);
        next.openQuestions[idx] = {
          ...next.openQuestions[idx]!,
          category: "conflict",
          conflictingStatements: patch.statements,
        };
        break;
      }
    }
  }

  return next;
}

function loadMockResponses(): MockResponsesFile {
  const path = join(process.cwd(), "data/sample/mock_responses.json");
  return JSON.parse(readFileSync(path, "utf-8")) as MockResponsesFile;
}

describe("Mock応答: Zod制約適合性", () => {
  const mock = loadMockResponses();

  it("chunk_001 適用後: 有効な ProcessModel", () => {
    const model = emptyProcessModel("test", "デモ会議");
    const applied = applyPatches(model, mock.chunk_001.patches);
    const result = ProcessModel.safeParse(applied);
    if (!result.success) {
      console.error(result.error.issues);
    }
    expect(result.success).toBe(true);
  });

  it("chunk_001 → chunk_002 適用後: 有効", () => {
    let model = emptyProcessModel("test", "デモ会議");
    model = applyPatches(model, mock.chunk_001.patches);
    model = applyPatches(model, mock.chunk_002.patches);
    const result = ProcessModel.safeParse(model);
    if (!result.success) {
      console.error(result.error.issues);
    }
    expect(result.success).toBe(true);
  });

  it("chunk_001 → chunk_002 → chunk_003 全適用後: 有効", () => {
    let model = emptyProcessModel("test", "デモ会議");
    model = applyPatches(model, mock.chunk_001.patches);
    model = applyPatches(model, mock.chunk_002.patches);
    model = applyPatches(model, mock.chunk_003.patches);
    const result = ProcessModel.safeParse(model);
    if (!result.success) {
      console.error(result.error.issues);
    }
    expect(result.success).toBe(true);
  });
});

describe("Mock応答: デモで見せる要素の網羅", () => {
  const mock = loadMockResponses();
  let finalModel: ProcessModel;

  {
    let m = emptyProcessModel("test", "デモ会議");
    m = applyPatches(m, mock.chunk_001.patches);
    m = applyPatches(m, mock.chunk_002.patches);
    m = applyPatches(m, mock.chunk_003.patches);
    finalModel = m;
  }

  it("confirmed Step が7件以上存在 (中材14工程の主要部分)", () => {
    const confirmedCount = finalModel.steps.filter(
      (s) => s.confidence === "confirmed"
    ).length;
    expect(confirmedCount).toBeGreaterThanOrEqual(7);
  });

  it("unknown Step が1件以上存在 (実績登録)", () => {
    const unknownSteps = finalModel.steps.filter(
      (s) => s.confidence === "unknown"
    );
    expect(unknownSteps.length).toBeGreaterThanOrEqual(1);
    expect(unknownSteps.some((s) => s.label.includes("実績登録"))).toBe(true);
  });

  it("conflict OpenQuestion が存在 (3説対立の実績登録)", () => {
    const conflicts = finalModel.openQuestions.filter(
      (q) => q.category === "conflict"
    );
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const conflict = conflicts[0]!;
    expect(conflict.conflictingStatements.length).toBeGreaterThanOrEqual(2);
  });

  it("to_be フェーズの Step が存在 (パス自動発行)", () => {
    const toBeSteps = finalModel.steps.filter((s) => s.phase === "to_be");
    expect(toBeSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("全 confirmed Step が sources を持つ (制約2の実データ確認)", () => {
    const violations = finalModel.steps.filter(
      (s) => s.confidence === "confirmed" && s.sources.length === 0
    );
    expect(violations).toHaveLength(0);
  });

  it("全 unknown Step に対応する OpenQuestion がある (制約1の実データ確認)", () => {
    const stepIdsInQuestions = new Set<string>();
    finalModel.openQuestions.forEach((q) =>
      q.relatedStepIds.forEach((sid) => stepIdsInQuestions.add(sid))
    );
    const orphan = finalModel.steps.filter(
      (s) => s.confidence === "unknown" && !stepIdsInQuestions.has(s.id)
    );
    expect(orphan).toHaveLength(0);
  });
});
