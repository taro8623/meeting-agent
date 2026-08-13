import { ProcessModel, ProcessModel as ProcessModelSchema } from "../schema/processModel.js";
import { Patch, ApplyPatchArgs } from "../llm/tools.js";
import { z } from "zod";

/**
 * ProcessModel にパッチを適用する 純粋関数。
 * 入力Modelは変更せず、新しいModelを返す。
 *
 * 呼び出し順:
 *   1. LLMが返した tool_call arguments を ApplyPatchArgs.parse() で 型検証
 *   2. applyPatches() でパッチを1つずつ適用
 *   3. ProcessModel.parse() で superRefine 4制約を最終検証
 *   4. 失敗ならエラー要約を LLMに返して 1回だけリトライ
 */

export interface ApplyResult {
  success: boolean;
  model?: ProcessModel;
  /** LLMに返す用の エラー要約 */
  errorSummary?: string;
  /** どのパッチが何件適用されたか */
  appliedCounts?: {
    add_step: number;
    update_step: number;
    add_edge: number;
    add_question: number;
    resolve_question: number;
    flag_conflict: number;
  };
}

export function applyPatchesAndValidate(
  currentModel: ProcessModel,
  rawArguments: unknown
): ApplyResult {
  // Step 1: tool_call arguments の型検証
  const argsResult = ApplyPatchArgs.safeParse(rawArguments);
  if (!argsResult.success) {
    return {
      success: false,
      errorSummary: formatZodError(
        argsResult.error,
        "apply_process_patch の引数形式が不正"
      ),
    };
  }

  const patches = argsResult.data.patches;

  // Step 2: パッチ適用
  let next: ProcessModel;
  try {
    next = applyPatches(currentModel, patches);
  } catch (e) {
    return {
      success: false,
      errorSummary: e instanceof Error ? e.message : String(e),
    };
  }

  // Step 3: superRefine 4制約 で最終検証
  const finalResult = ProcessModelSchema.safeParse(next);
  if (!finalResult.success) {
    return {
      success: false,
      errorSummary: formatZodError(
        finalResult.error,
        "パッチ適用後の ProcessModel が制約違反"
      ),
    };
  }

  return {
    success: true,
    model: finalResult.data,
    appliedCounts: countPatches(patches),
  };
}

function applyPatches(model: ProcessModel, patches: Patch[]): ProcessModel {
  const next: ProcessModel = {
    ...model,
    steps: [...model.steps],
    edges: [...model.edges],
    openQuestions: [...model.openQuestions],
    updatedAt: new Date().toISOString(),
  };

  for (const patch of patches) {
    switch (patch.op) {
      case "add_step": {
        if (next.steps.some((s) => s.id === patch.step.id)) {
          throw new Error(`Step id "${patch.step.id}" は既に存在します`);
        }
        next.steps.push(patch.step);
        break;
      }
      case "update_step": {
        const idx = next.steps.findIndex((s) => s.id === patch.id);
        if (idx === -1) {
          throw new Error(`Step id "${patch.id}" が見つかりません (update_step)`);
        }
        next.steps[idx] = { ...next.steps[idx]!, ...patch.changes };
        break;
      }
      case "add_edge": {
        next.edges.push(patch.edge);
        break;
      }
      case "add_question": {
        if (next.openQuestions.some((q) => q.id === patch.question.id)) {
          throw new Error(
            `OpenQuestion id "${patch.question.id}" は既に存在します`
          );
        }
        next.openQuestions.push(patch.question);
        break;
      }
      case "resolve_question": {
        const idx = next.openQuestions.findIndex((q) => q.id === patch.id);
        if (idx === -1) {
          throw new Error(
            `OpenQuestion id "${patch.id}" が見つかりません (resolve_question)`
          );
        }
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
        if (idx === -1) {
          throw new Error(
            `OpenQuestion id "${patch.questionId}" が見つかりません (flag_conflict)`
          );
        }
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

function countPatches(patches: Patch[]) {
  const counts = {
    add_step: 0,
    update_step: 0,
    add_edge: 0,
    add_question: 0,
    resolve_question: 0,
    flag_conflict: 0,
  };
  for (const p of patches) counts[p.op]++;
  return counts;
}

/** ZodError を LLMに返す用の短い日本語要約に変換 */
function formatZodError(err: z.ZodError, prefix: string): string {
  const lines = err.issues.slice(0, 10).map((issue) => {
    const path = issue.path.join(".");
    return `  - [${path || "root"}] ${issue.message}`;
  });
  return `${prefix}\n${lines.join("\n")}`;
}
