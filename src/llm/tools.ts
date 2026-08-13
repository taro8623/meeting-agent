import { z } from "zod";
import {
  Step,
  Edge,
  OpenQuestion,
  ConflictingStatement,
} from "../schema/processModel.js";
import { ToolDefinition } from "./types.js";

/**
 * apply_process_patch ツール — 唯一のTool Use。
 * ProcessModel 全体を書き直させず、パッチ操作だけを受け付ける。
 * (SPEC §4「削除操作は用意しない — 過去の蓄積が失われるのを防ぐ」)
 */

export const Patch = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_step"), step: Step }),
  z.object({
    op: z.literal("update_step"),
    id: z.string(),
    changes: Step.partial(),
  }),
  z.object({ op: z.literal("add_edge"), edge: Edge }),
  z.object({ op: z.literal("add_question"), question: OpenQuestion }),
  z.object({
    op: z.literal("resolve_question"),
    id: z.string(),
    answer: z.string(),
    source: z.object({
      chunkId: z.string(),
      speaker: z.string().nullable(),
      timestamp: z.string().nullable(),
      quote: z.string().max(200),
    }),
  }),
  z.object({
    op: z.literal("flag_conflict"),
    questionId: z.string(),
    statements: z.array(ConflictingStatement).min(2, "conflict は最低2件"),
  }),
]);

export type Patch = z.infer<typeof Patch>;

export const ApplyPatchArgs = z.object({
  patches: z.array(Patch).min(1, "少なくとも1つのパッチが必要"),
});

export type ApplyPatchArgs = z.infer<typeof ApplyPatchArgs>;

/** LLMに渡すツール定義 (JSON Schema, Ollama Tool Use互換) */
export const APPLY_PROCESS_PATCH_TOOL: ToolDefinition = {
  name: "apply_process_patch",
  description:
    "会議の発言から抽出した業務プロセスの変更点を、パッチ操作の配列として提出する。" +
    "パッチは以下のいずれか: " +
    "add_step (新規ステップ追加), " +
    "update_step (既存ステップの変更), " +
    "add_edge (ステップ間の遷移追加), " +
    "add_question (未確定事項の起票), " +
    "resolve_question (未確定事項の解決), " +
    "flag_conflict (参加者間の矛盾を記録)。" +
    "推測は禁止。発言に明示されていない情報を埋めてはならない。" +
    "不明な項目は confidence=unknown で登録し、対応する OpenQuestion を必ず起票すること。",
  inputSchema: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        minItems: 1,
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                op: { type: "string", enum: ["add_step"] },
                step: {
                  type: "object",
                  properties: {
                    id: { type: "string", pattern: "^s\\d+$" },
                    label: { type: "string" },
                    actor: { type: ["string", "null"] },
                    system: { type: ["string", "null"] },
                    phase: { type: "string", enum: ["as_is", "to_be"] },
                    confidence: {
                      type: "string",
                      enum: ["confirmed", "assumed", "unknown"],
                    },
                    sources: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          chunkId: { type: "string" },
                          speaker: { type: ["string", "null"] },
                          timestamp: { type: ["string", "null"] },
                          quote: { type: "string", maxLength: 200 },
                        },
                        required: ["chunkId", "speaker", "timestamp", "quote"],
                      },
                    },
                  },
                  required: [
                    "id",
                    "label",
                    "actor",
                    "system",
                    "phase",
                    "confidence",
                    "sources",
                  ],
                },
              },
              required: ["op", "step"],
            },
            {
              type: "object",
              properties: {
                op: { type: "string", enum: ["add_edge"] },
                edge: {
                  type: "object",
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    label: { type: ["string", "null"] },
                    confidence: {
                      type: "string",
                      enum: ["confirmed", "assumed", "unknown"],
                    },
                  },
                  required: ["from", "to", "label", "confidence"],
                },
              },
              required: ["op", "edge"],
            },
            {
              type: "object",
              properties: {
                op: { type: "string", enum: ["add_question"] },
                question: {
                  type: "object",
                  properties: {
                    id: { type: "string", pattern: "^q\\d+$" },
                    question: { type: "string" },
                    relatedStepIds: { type: "array", items: { type: "string" } },
                    category: {
                      type: "string",
                      enum: [
                        "actor",
                        "trigger",
                        "branch",
                        "system",
                        "conflict",
                        "other",
                      ],
                    },
                    conflictingStatements: { type: "array" },
                    status: { type: "string", enum: ["open", "answered"] },
                    answer: { type: ["string", "null"] },
                    answeredAt: { type: ["string", "null"] },
                    raisedAtChunk: { type: "string" },
                  },
                  required: [
                    "id",
                    "question",
                    "relatedStepIds",
                    "category",
                    "conflictingStatements",
                    "status",
                    "answer",
                    "answeredAt",
                    "raisedAtChunk",
                  ],
                },
              },
              required: ["op", "question"],
            },
            {
              type: "object",
              properties: {
                op: { type: "string", enum: ["flag_conflict"] },
                questionId: { type: "string" },
                statements: {
                  type: "array",
                  minItems: 2,
                  items: {
                    type: "object",
                    properties: {
                      speaker: { type: ["string", "null"] },
                      claim: { type: "string" },
                      source: {
                        type: "object",
                        properties: {
                          chunkId: { type: "string" },
                          speaker: { type: ["string", "null"] },
                          timestamp: { type: ["string", "null"] },
                          quote: { type: "string", maxLength: 200 },
                        },
                        required: [
                          "chunkId",
                          "speaker",
                          "timestamp",
                          "quote",
                        ],
                      },
                    },
                    required: ["speaker", "claim", "source"],
                  },
                },
              },
              required: ["op", "questionId", "statements"],
            },
          ],
        },
      },
    },
    required: ["patches"],
  },
};

export const ALL_TOOLS: ToolDefinition[] = [APPLY_PROCESS_PATCH_TOOL];
