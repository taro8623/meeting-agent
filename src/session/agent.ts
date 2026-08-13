import { ProcessModel } from "../schema/processModel.js";
import { LLMClient, ChatMessage } from "../llm/types.js";
import { ALL_TOOLS } from "../llm/tools.js";
import { SYSTEM_PROMPT, buildUserMessage, buildRetryMessage } from "../llm/prompts.js";
import { applyPatchesAndValidate, ApplyResult } from "./patcher.js";

/**
 * エージェントループ (最大2ターン)
 *
 * Turn 1:
 *   LLM → apply_process_patch → Zod検証
 *     - 成功: 更新された Model を返して終了
 *     - 失敗: Turn 2 へ (エラー要約を返送)
 *
 * Turn 2:
 *   LLM → apply_process_patch (修正版) → Zod検証
 *     - 成功: 更新された Model を返して終了
 *     - 失敗: 安全終了 (元Model維持、パッチ適用なし)
 *
 * SPEC縮小版の要求どおり「複雑なエージェントループ禁止」を遵守。
 */

export interface AgentTurnLog {
  turn: 1 | 2;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCallName?: string;
  patchCount?: number;
  validationOk: boolean;
  errorSummary?: string;
}

export interface AgentResult {
  /** パッチが最終的に適用されたか */
  applied: boolean;
  /** 適用後 or 適用失敗時は元 Model */
  finalModel: ProcessModel;
  turns: AgentTurnLog[];
  /** 課金累計 (常に 0.00 / Ollama+Mock) */
  totalCostUsd: number;
  /** 適用件数 (成功時のみ) */
  appliedCounts?: ApplyResult["appliedCounts"];
}

export interface AgentInput {
  llm: LLMClient;
  currentModel: ProcessModel;
  chunkId: string;
  chunkText: string;
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { llm, currentModel, chunkId, chunkText } = input;
  const turns: AgentTurnLog[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(currentModel, chunkId, chunkText) },
  ];

  // === Turn 1 ===
  const turn1Result = await callAndValidate(llm, messages, currentModel, 1);
  turns.push(turn1Result.log);

  if (turn1Result.applyResult.success) {
    return {
      applied: true,
      finalModel: turn1Result.applyResult.model!,
      turns,
      totalCostUsd: sumCost(turns),
      appliedCounts: turn1Result.applyResult.appliedCounts,
    };
  }

  // === Turn 2 (リトライ 1回のみ) ===
  messages.push({
    role: "assistant",
    content: JSON.stringify(turn1Result.rawToolCall ?? {}),
  });
  messages.push({
    role: "user",
    content: buildRetryMessage(
      turn1Result.applyResult.errorSummary ?? "エラー詳細不明"
    ),
  });

  const turn2Result = await callAndValidate(llm, messages, currentModel, 2);
  turns.push(turn2Result.log);

  if (turn2Result.applyResult.success) {
    return {
      applied: true,
      finalModel: turn2Result.applyResult.model!,
      turns,
      totalCostUsd: sumCost(turns),
      appliedCounts: turn2Result.applyResult.appliedCounts,
    };
  }

  // === 安全終了: 元 Model を維持し、パッチ適用しない ===
  return {
    applied: false,
    finalModel: currentModel,
    turns,
    totalCostUsd: sumCost(turns),
  };
}

async function callAndValidate(
  llm: LLMClient,
  messages: ChatMessage[],
  currentModel: ProcessModel,
  turn: 1 | 2
): Promise<{
  log: AgentTurnLog;
  applyResult: ApplyResult;
  rawToolCall: unknown;
}> {
  const res = await llm.call({ messages, tools: ALL_TOOLS });

  const toolCall = res.toolCalls.find((tc) => tc.name === "apply_process_patch");
  if (!toolCall) {
    return {
      log: {
        turn,
        latencyMs: res.latencyMs,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        costUsd: res.usage.costUsd,
        validationOk: false,
        errorSummary: "LLMが apply_process_patch を呼び出さなかった",
      },
      applyResult: {
        success: false,
        errorSummary: "LLMが apply_process_patch を呼び出さなかった",
      },
      rawToolCall: null,
    };
  }

  const applyResult = applyPatchesAndValidate(currentModel, toolCall.arguments);

  return {
    log: {
      turn,
      latencyMs: res.latencyMs,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: res.usage.costUsd,
      toolCallName: toolCall.name,
      patchCount: countArgsPatches(toolCall.arguments),
      validationOk: applyResult.success,
      errorSummary: applyResult.errorSummary,
    },
    applyResult,
    rawToolCall: toolCall,
  };
}

function countArgsPatches(args: unknown): number {
  if (
    typeof args === "object" &&
    args !== null &&
    "patches" in args &&
    Array.isArray((args as { patches: unknown[] }).patches)
  ) {
    return (args as { patches: unknown[] }).patches.length;
  }
  return 0;
}

function sumCost(turns: AgentTurnLog[]): number {
  return turns.reduce((s, t) => s + t.costUsd, 0);
}
