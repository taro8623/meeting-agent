import { describe, it, expect } from "vitest";
import { runAgent } from "../session/agent.js";
import { MockClient } from "../llm/MockClient.js";
import { LLMClient, CallRequest, LLMResponse } from "../llm/types.js";
import { emptyProcessModel } from "../schema/processModel.js";
import { readFileSync } from "fs";
import { join } from "path";

function loadChunk(name: string): string {
  return readFileSync(join(process.cwd(), "data/sample", name), "utf-8");
}

describe("エージェントループ (2ターン制限)", () => {
  it("Turn 1 で成功 → 1ターンで終了", async () => {
    const result = await runAgent({
      llm: new MockClient(),
      currentModel: emptyProcessModel("test", "デモ"),
      chunkId: "chunk_001",
      chunkText: loadChunk("chunk_01.txt"),
    });

    expect(result.applied).toBe(true);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]!.validationOk).toBe(true);
    expect(result.totalCostUsd).toBe(0);
    expect(result.finalModel.steps.length).toBeGreaterThan(0);
  });

  it("3チャンクを順次適用 → 最終Modelが有効", async () => {
    const llm = new MockClient();
    let model = emptyProcessModel("test", "デモ");

    for (const [id, file] of [
      ["chunk_001", "chunk_01.txt"],
      ["chunk_002", "chunk_02.txt"],
      ["chunk_003", "chunk_03.txt"],
    ] as const) {
      const r = await runAgent({
        llm,
        currentModel: model,
        chunkId: id,
        chunkText: loadChunk(file),
      });
      expect(r.applied).toBe(true);
      model = r.finalModel;
    }

    // 最終モデルは confirmed + unknown + conflict すべて含む
    expect(model.steps.filter((s) => s.confidence === "confirmed").length).toBeGreaterThanOrEqual(
      7
    );
    expect(model.steps.filter((s) => s.confidence === "unknown").length).toBeGreaterThanOrEqual(
      1
    );
    expect(model.openQuestions.filter((q) => q.category === "conflict").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("LLMが何も返さない → 安全終了 (元Model維持)", async () => {
    const emptyLLM: LLMClient = {
      name: "EmptyMock",
      isFree: true,
      async call(_req: CallRequest): Promise<LLMResponse> {
        return {
          toolCalls: [],
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          latencyMs: 1,
        };
      },
    };
    const original = emptyProcessModel("test", "デモ");
    const result = await runAgent({
      llm: emptyLLM,
      currentModel: original,
      chunkId: "chunk_001",
      chunkText: "テスト",
    });

    expect(result.applied).toBe(false);
    expect(result.finalModel.steps).toHaveLength(0); // 元のまま
    expect(result.turns.length).toBeLessThanOrEqual(2);
  });

  it("Turn 1が Zod失敗 → Turn 2 で再試行するが 2ターン超えない", async () => {
    // Zod制約違反 (unknown Step あるが OpenQuestion なし) を毎回返すLLM
    const badLLM: LLMClient = {
      name: "BadMock",
      isFree: true,
      async call(_req: CallRequest): Promise<LLMResponse> {
        return {
          toolCalls: [
            {
              name: "apply_process_patch",
              arguments: {
                patches: [
                  {
                    op: "add_step",
                    step: {
                      id: "s1",
                      label: "壊れたStep",
                      actor: null,
                      system: null,
                      phase: "as_is",
                      confidence: "unknown", // ← unknownなのに OpenQuestion 追加してない = 制約1違反
                      sources: [],
                    },
                  },
                ],
              },
            },
          ],
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          latencyMs: 1,
        };
      },
    };

    const original = emptyProcessModel("test", "デモ");
    const result = await runAgent({
      llm: badLLM,
      currentModel: original,
      chunkId: "chunk_001",
      chunkText: "テスト",
    });

    expect(result.applied).toBe(false); // 2ターンとも失敗 → 適用なし
    expect(result.finalModel.steps).toHaveLength(0); // 元Model維持
    expect(result.turns).toHaveLength(2); // 上限に達した
    expect(result.turns[0]!.validationOk).toBe(false);
    expect(result.turns[1]!.validationOk).toBe(false);
    expect(result.turns[0]!.errorSummary).toContain("OpenQuestion");
  });

  it("Turn 1失敗 → Turn 2 で修正版を返す → 成功", async () => {
    let callCount = 0;
    const smartLLM: LLMClient = {
      name: "SmartMock",
      isFree: true,
      async call(_req: CallRequest): Promise<LLMResponse> {
        callCount++;
        if (callCount === 1) {
          // 1回目は 制約1違反
          return {
            toolCalls: [
              {
                name: "apply_process_patch",
                arguments: {
                  patches: [
                    {
                      op: "add_step",
                      step: {
                        id: "s1",
                        label: "壊れたStep",
                        actor: null,
                        system: null,
                        phase: "as_is",
                        confidence: "unknown",
                        sources: [],
                      },
                    },
                  ],
                },
              },
            ],
            text: "",
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
            latencyMs: 1,
          };
        }
        // 2回目は 修正版
        return {
          toolCalls: [
            {
              name: "apply_process_patch",
              arguments: {
                patches: [
                  {
                    op: "add_step",
                    step: {
                      id: "s1",
                      label: "修正版Step",
                      actor: null,
                      system: null,
                      phase: "as_is",
                      confidence: "unknown",
                      sources: [],
                    },
                  },
                  {
                    op: "add_question",
                    question: {
                      id: "q1",
                      question: "s1 の担当は?",
                      relatedStepIds: ["s1"],
                      category: "actor",
                      conflictingStatements: [],
                      status: "open",
                      answer: null,
                      answeredAt: null,
                      raisedAtChunk: "chunk_001",
                    },
                  },
                ],
              },
            },
          ],
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          latencyMs: 1,
        };
      },
    };

    const result = await runAgent({
      llm: smartLLM,
      currentModel: emptyProcessModel("test", "デモ"),
      chunkId: "chunk_001",
      chunkText: "テスト",
    });

    expect(result.applied).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]!.validationOk).toBe(false);
    expect(result.turns[1]!.validationOk).toBe(true);
    expect(result.finalModel.steps).toHaveLength(1);
    expect(result.finalModel.openQuestions).toHaveLength(1);
  });

  it("課金は常にゼロ (Ollama/Mockの契約)", async () => {
    const result = await runAgent({
      llm: new MockClient(),
      currentModel: emptyProcessModel("test", "デモ"),
      chunkId: "chunk_001",
      chunkText: loadChunk("chunk_01.txt"),
    });
    expect(result.totalCostUsd).toBe(0);
    result.turns.forEach((t) => expect(t.costUsd).toBe(0));
  });
});
