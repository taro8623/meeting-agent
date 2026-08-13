import { describe, it, expect } from "vitest";
import {
  ProcessModel,
  Step,
  Edge,
  OpenQuestion,
  SourceRef,
  ConflictingStatement,
  emptyProcessModel,
} from "./processModel.js";

// ============================================================
// テスト用のビルダー (可読性のため)
// ============================================================

function makeSource(chunkId = "chunk_001", quote = "テスト発言"): SourceRef {
  return {
    chunkId,
    speaker: "田中さん",
    timestamp: "00:01:00",
    quote,
  };
}

function makeStep(
  id: string,
  overrides: Partial<Step> = {}
): Step {
  return {
    id,
    label: "テストステップ",
    actor: "看護師",
    system: null,
    phase: "as_is",
    confidence: "confirmed",
    sources: [makeSource()],
    ...overrides,
  };
}

function makeEdge(from: string, to: string, overrides: Partial<Edge> = {}): Edge {
  return {
    from,
    to,
    label: null,
    confidence: "confirmed",
    ...overrides,
  };
}

function makeQuestion(
  id: string,
  overrides: Partial<OpenQuestion> = {}
): OpenQuestion {
  return {
    id,
    question: "テスト質問",
    relatedStepIds: [],
    category: "actor",
    conflictingStatements: [],
    status: "open",
    answer: null,
    answeredAt: null,
    raisedAtChunk: "chunk_001",
    ...overrides,
  };
}

function makeConflict(speaker: string, claim: string): ConflictingStatement {
  return {
    speaker,
    claim,
    source: makeSource("chunk_001", claim),
  };
}

function makeModel(overrides: Partial<ProcessModel> = {}): ProcessModel {
  return {
    ...emptyProcessModel("test_session", "テスト会議"),
    ...overrides,
  };
}

// ============================================================
// 基本的な型バリデーション
// ============================================================

describe("ProcessModel 基本バリデーション", () => {
  it("空の ProcessModel はバリデーション通過", () => {
    const model = makeModel();
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(true);
  });

  it("emptyProcessModel が返すデフォルト値は有効", () => {
    const model = emptyProcessModel("s1", "会議A");
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("Step id が不正な形式ならエラー (s1, s2, ... のみ許容)", () => {
    const model = makeModel({
      steps: [makeStep("step1")], // ❌ "step1" は "s\d+" 形式外
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
  });

  it("OpenQuestion id が不正な形式ならエラー", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "unknown" })],
      openQuestions: [
        makeQuestion("question1", { relatedStepIds: ["s1"] }), // ❌
      ],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
  });

  it("SourceRef の quote が200字超えるとエラー", () => {
    const longQuote = "あ".repeat(201);
    const model = makeModel({
      steps: [
        makeStep("s1", {
          sources: [{ ...makeSource(), quote: longQuote }],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(false);
  });
});

// ============================================================
// 制約1: unknown Step には OpenQuestion が必須
// ============================================================

describe("制約1: unknown Step には OpenQuestion が必須", () => {
  it("❌ unknown Step があるが OpenQuestion がない → エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "unknown", sources: [] })],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("OpenQuestion が存在しない"))).toBe(true);
    }
  });

  it("❌ unknown Step があり OpenQuestion もあるが relatedStepIds に含まれない → エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "unknown", sources: [] })],
      openQuestions: [makeQuestion("q1", { relatedStepIds: ["s2"] })], // 別のStep
    });
    expect(ProcessModel.safeParse(model).success).toBe(false);
  });

  it("✅ unknown Step に対応する OpenQuestion がある → 通過", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "unknown", sources: [] })],
      openQuestions: [makeQuestion("q1", { relatedStepIds: ["s1"] })],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("✅ confirmed Step は OpenQuestion 不要", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "confirmed" })],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("✅ assumed Step は OpenQuestion 不要 (unknown だけが対象)", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "assumed", sources: [] })],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });
});

// ============================================================
// 制約2: confirmed Step は sources 最低1件必要
// ============================================================

describe("制約2: confirmed Step は sources 最低1件必要", () => {
  it("❌ confirmed Step で sources が空 → エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "confirmed", sources: [] })],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) => m.includes("sources が最低1件必要"))
      ).toBe(true);
    }
  });

  it("✅ confirmed Step で sources が1件以上 → 通過", () => {
    const model = makeModel({
      steps: [
        makeStep("s1", {
          confidence: "confirmed",
          sources: [makeSource()],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("✅ unknown Step は sources 空でもOK (制約2の対象外)", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "unknown", sources: [] })],
      openQuestions: [makeQuestion("q1", { relatedStepIds: ["s1"] })],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("✅ assumed Step は sources 空でもOK", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "assumed", sources: [] })],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });
});

// ============================================================
// 制約3: conflict OpenQuestion は conflictingStatements 2件以上
// ============================================================

describe("制約3: conflict OpenQuestion は conflictingStatements 2件以上", () => {
  it("❌ conflict カテゴリで conflictingStatements 空 → エラー", () => {
    const model = makeModel({
      openQuestions: [
        makeQuestion("q1", {
          category: "conflict",
          conflictingStatements: [],
        }),
      ],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) => m.includes("conflictingStatements が2件以上必要"))
      ).toBe(true);
    }
  });

  it("❌ conflict カテゴリで conflictingStatements 1件のみ → エラー", () => {
    const model = makeModel({
      openQuestions: [
        makeQuestion("q1", {
          category: "conflict",
          conflictingStatements: [makeConflict("田中", "看護師がやる")],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(false);
  });

  it("✅ conflict カテゴリで conflictingStatements 2件 → 通過", () => {
    const model = makeModel({
      openQuestions: [
        makeQuestion("q1", {
          category: "conflict",
          conflictingStatements: [
            makeConflict("田中", "看護師が入力"),
            makeConflict("佐藤", "部門で入力"),
          ],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("✅ conflict 以外のカテゴリは conflictingStatements 空でもOK", () => {
    const model = makeModel({
      openQuestions: [
        makeQuestion("q1", {
          category: "actor",
          conflictingStatements: [],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });
});

// ============================================================
// 制約4: Edge の from/to は既存 Step id を参照
// ============================================================

describe("制約4: Edge の from/to は既存 Step id を参照", () => {
  it("❌ 存在しない Step id を from に指定 → エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1")],
      edges: [makeEdge("s99", "s1")], // s99 は存在しない
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) => m.includes('Edge.from "s99"'))
      ).toBe(true);
    }
  });

  it("❌ 存在しない Step id を to に指定 → エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1")],
      edges: [makeEdge("s1", "s99")],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('Edge.to "s99"'))).toBe(true);
    }
  });

  it("❌ from も to も存在しない → 両方エラー", () => {
    const model = makeModel({
      steps: [makeStep("s1")],
      edges: [makeEdge("s98", "s99")],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("✅ 全て有効な Step id を参照 → 通過", () => {
    const model = makeModel({
      steps: [makeStep("s1"), makeStep("s2")],
      edges: [makeEdge("s1", "s2")],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });
});

// ============================================================
// 複合ケース (実際の会議で起こりそうな組み合わせ)
// ============================================================

describe("複合ケース: 実際の会議シナリオ", () => {
  it("✅ 現実的な会議データ (confirmed + unknown + conflict + edges) 全て通過", () => {
    const model = makeModel({
      steps: [
        makeStep("s1", {
          label: "手術器材の返却",
          confidence: "confirmed",
          sources: [makeSource("chunk_001", "手術後 器材を中材へ返却")],
        }),
        makeStep("s2", {
          label: "実績登録",
          confidence: "unknown",
          sources: [],
        }),
        makeStep("s3", {
          label: "滅菌工程",
          confidence: "assumed",
          sources: [],
        }),
      ],
      edges: [makeEdge("s1", "s2"), makeEdge("s2", "s3")],
      openQuestions: [
        makeQuestion("q1", {
          question: "実績登録は誰が行うか",
          relatedStepIds: ["s2"],
          category: "conflict",
          conflictingStatements: [
            makeConflict("田中", "看護師が入力します"),
            makeConflict("佐藤", "あれは部門で入れてる"),
          ],
        }),
      ],
    });
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });

  it("❌ 複数の違反が同時に発生 → 全て検出される", () => {
    const model = makeModel({
      steps: [
        makeStep("s1", { confidence: "confirmed", sources: [] }), // 制約2違反
        makeStep("s2", { confidence: "unknown", sources: [] }), // 制約1違反
      ],
      edges: [makeEdge("s1", "s99")], // 制約4違反
      openQuestions: [
        makeQuestion("q1", {
          category: "conflict",
          conflictingStatements: [], // 制約3違反
        }),
      ],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      // 4つの制約違反が全て検出される
      expect(result.error.issues.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("✅ 空のモデルから 段階的に組み上げた最終状態が有効", () => {
    // シナリオ: 会議中に情報が積み上がっていく
    let model = emptyProcessModel("s1", "A病院 要件定義");

    // 1. Step 追加
    model = {
      ...model,
      steps: [
        makeStep("s1", {
          label: "手術後 器材回収",
          confidence: "confirmed",
        }),
      ],
    };
    expect(ProcessModel.safeParse(model).success).toBe(true);

    // 2. 未確定 Step + OpenQuestion 追加
    model = {
      ...model,
      steps: [
        ...model.steps,
        makeStep("s2", {
          label: "実績登録",
          confidence: "unknown",
          sources: [],
        }),
      ],
      openQuestions: [
        makeQuestion("q1", {
          question: "実績登録の担当は?",
          relatedStepIds: ["s2"],
          category: "actor",
        }),
      ],
    };
    expect(ProcessModel.safeParse(model).success).toBe(true);

    // 3. Edge 追加
    model = {
      ...model,
      edges: [makeEdge("s1", "s2")],
    };
    expect(ProcessModel.safeParse(model).success).toBe(true);

    // 4. OpenQuestion が answered になる
    model = {
      ...model,
      openQuestions: [
        {
          ...model.openQuestions[0]!,
          status: "answered" as const,
          answer: "看護師が入力",
          answeredAt: "2026-08-07T10:00:00Z",
        },
      ],
    };
    expect(ProcessModel.safeParse(model).success).toBe(true);
  });
});

// ============================================================
// エラーメッセージの検証 (LLMに返して自己修正させる用)
// ============================================================

describe("エラーメッセージの明確性 (LLM自己修正用)", () => {
  it("エラーメッセージには 違反した Step / OpenQuestion の id が含まれる", () => {
    const model = makeModel({
      steps: [makeStep("s42", { confidence: "unknown", sources: [] })],
    });
    const result = ProcessModel.safeParse(model);
    expect(result.success).toBe(false);
    if (!result.success) {
      const allMessages = result.error.issues.map((i) => i.message).join(" | ");
      expect(allMessages).toContain("s42");
    }
  });

  it("エラーメッセージには 修正方法のヒントが含まれる", () => {
    const model = makeModel({
      steps: [makeStep("s1", { confidence: "confirmed", sources: [] })],
    });
    const result = ProcessModel.safeParse(model);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      // "sources が最低1件必要" のようなヒントメッセージがある
      expect(messages.some((m) => m.includes("必要"))).toBe(true);
    }
  });
});
