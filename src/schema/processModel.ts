import { z } from "zod";

export const Confidence = z.enum(["confirmed", "assumed", "unknown"]);
export type Confidence = z.infer<typeof Confidence>;

export const SourceRef = z.object({
  chunkId: z.string(),
  speaker: z.string().nullable(),
  timestamp: z.string().nullable(),
  quote: z.string().max(200),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Step = z.object({
  id: z.string().regex(/^s\d+$/, "Step id は s1, s2, ... の形式"),
  label: z.string().min(1),
  actor: z.string().nullable(),
  system: z.string().nullable(),
  phase: z.enum(["as_is", "to_be"]),
  confidence: Confidence,
  sources: z.array(SourceRef),
});
export type Step = z.infer<typeof Step>;

export const Edge = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().nullable(),
  confidence: Confidence,
});
export type Edge = z.infer<typeof Edge>;

export const ConflictingStatement = z.object({
  speaker: z.string().nullable(),
  claim: z.string().min(1),
  source: SourceRef,
});
export type ConflictingStatement = z.infer<typeof ConflictingStatement>;

export const OpenQuestion = z.object({
  id: z.string().regex(/^q\d+$/, "OpenQuestion id は q1, q2, ... の形式"),
  question: z.string().min(1),
  relatedStepIds: z.array(z.string()),
  category: z.enum(["actor", "trigger", "branch", "system", "conflict", "other"]),
  conflictingStatements: z.array(ConflictingStatement),
  status: z.enum(["open", "answered"]),
  answer: z.string().nullable(),
  answeredAt: z.string().nullable(),
  raisedAtChunk: z.string(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/**
 * ProcessModel — このアプリの中核データ構造。図もWordもExcelも すべてここからの出力。
 * superRefine で下記4つの制約を強制する:
 *   1) confidence=unknown の Step には 対応する OpenQuestion が必須
 *   2) confidence=confirmed の Step は sources を最低1件必要
 *   3) category=conflict の OpenQuestion は conflictingStatements が2件以上必要
 *   4) Edge の from/to は 既存 Step id を参照していなければならない
 */
export const ProcessModel = z
  .object({
    sessionId: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string(),
    processedChunkIds: z.array(z.string()),
    steps: z.array(Step),
    edges: z.array(Edge),
    openQuestions: z.array(OpenQuestion),
    glossaryHits: z.array(z.string()),
  })
  .superRefine((model, ctx) => {
    // Step id → Step のインデックス
    const stepById = new Map(model.steps.map((s) => [s.id, s]));

    // 制約4: Edge の from/to は 既存 Step id を参照していなければならない
    model.edges.forEach((edge, idx) => {
      if (!stepById.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", idx, "from"],
          message: `Edge.from "${edge.from}" が既存 Step id に該当しない`,
        });
      }
      if (!stepById.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", idx, "to"],
          message: `Edge.to "${edge.to}" が既存 Step id に該当しない`,
        });
      }
    });

    // 制約2: confirmed Step は sources を最低1件必要
    model.steps.forEach((step, idx) => {
      if (step.confidence === "confirmed" && step.sources.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", idx, "sources"],
          message: `confirmed Step "${step.id}" は sources が最低1件必要 (推測禁止)`,
        });
      }
    });

    // 制約1: unknown Step には 対応する OpenQuestion が必須
    const stepIdsInQuestions = new Set<string>();
    model.openQuestions.forEach((q) => {
      q.relatedStepIds.forEach((sid) => stepIdsInQuestions.add(sid));
    });
    model.steps.forEach((step, idx) => {
      if (step.confidence === "unknown" && !stepIdsInQuestions.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", idx],
          message: `unknown Step "${step.id}" に対応する OpenQuestion が存在しない (relatedStepIds に含める必要あり)`,
        });
      }
    });

    // 制約3: conflict カテゴリの OpenQuestion は conflictingStatements 2件以上
    model.openQuestions.forEach((q, idx) => {
      if (q.category === "conflict" && q.conflictingStatements.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["openQuestions", idx, "conflictingStatements"],
          message: `category=conflict の OpenQuestion "${q.id}" は conflictingStatements が2件以上必要 (現在${q.conflictingStatements.length}件)`,
        });
      }
    });
  });

export type ProcessModel = z.infer<typeof ProcessModel>;

/**
 * 空の ProcessModel を作る (新規セッション用)
 */
export function emptyProcessModel(sessionId: string, title: string): ProcessModel {
  return {
    sessionId,
    title,
    updatedAt: new Date().toISOString(),
    processedChunkIds: [],
    steps: [],
    edges: [],
    openQuestions: [],
    glossaryHits: [],
  };
}
