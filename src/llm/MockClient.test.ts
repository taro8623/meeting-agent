import { describe, it, expect } from "vitest";
import { MockClient } from "./MockClient.js";
import { ALL_TOOLS } from "./tools.js";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompts.js";
import { emptyProcessModel } from "../schema/processModel.js";

describe("MockClient", () => {
  it("chunk_001 のユーザーメッセージ → 対応する tool_call を返す", async () => {
    const client = new MockClient();
    const model = emptyProcessModel("test", "デモ");
    const userMsg = buildUserMessage(model, "chunk_001", "手術後の器材回収...");

    const res = await client.call({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      tools: ALL_TOOLS,
    });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.name).toBe("apply_process_patch");
    expect(res.usage.costUsd).toBe(0);
    expect(res.usage.inputTokens).toBe(0);
    expect(res.usage.outputTokens).toBe(0);
  });

  it("該当なしの chunkId → 空の toolCalls を返す (エラーにしない)", async () => {
    const client = new MockClient();
    const model = emptyProcessModel("test", "デモ");
    const userMsg = buildUserMessage(model, "chunk_999", "存在しないチャンク");

    const res = await client.call({
      messages: [{ role: "user", content: userMsg }],
      tools: ALL_TOOLS,
    });

    expect(res.toolCalls).toHaveLength(0);
    expect(res.usage.costUsd).toBe(0);
  });

  it("リトライメッセージ (バリデーション失敗) → 空を返して安全終了", async () => {
    const client = new MockClient();
    const res = await client.call({
      messages: [
        { role: "user", content: "直前の apply_process_patch はバリデーション失敗しました。修正してください。" },
      ],
      tools: ALL_TOOLS,
    });

    expect(res.toolCalls).toHaveLength(0);
  });

  it("isFree = true (課金ゼロを型で明示)", () => {
    const client = new MockClient();
    expect(client.isFree).toBe(true);
  });

  it("chunk_002 → unknown Step + OpenQuestion の patches が返る", async () => {
    const client = new MockClient();
    const userMsg = buildUserMessage(
      emptyProcessModel("test", "デモ"),
      "chunk_002",
      "実績登録は…"
    );
    const res = await client.call({
      messages: [{ role: "user", content: userMsg }],
      tools: ALL_TOOLS,
    });

    const args = res.toolCalls[0]!.arguments as { patches: unknown[] };
    expect(args.patches.length).toBeGreaterThan(0);
    // unknown Step が含まれる
    const hasUnknownStep = args.patches.some((p) => {
      const patch = p as { op: string; step?: { confidence?: string } };
      return patch.op === "add_step" && patch.step?.confidence === "unknown";
    });
    expect(hasUnknownStep).toBe(true);
  });

  it("chunk_003 → flag_conflict パッチが含まれる", async () => {
    const client = new MockClient();
    const userMsg = buildUserMessage(
      emptyProcessModel("test", "デモ"),
      "chunk_003",
      "実績登録について..."
    );
    const res = await client.call({
      messages: [{ role: "user", content: userMsg }],
      tools: ALL_TOOLS,
    });

    const args = res.toolCalls[0]!.arguments as { patches: Array<{ op: string }> };
    const hasConflict = args.patches.some((p) => p.op === "flag_conflict");
    expect(hasConflict).toBe(true);
  });
});
