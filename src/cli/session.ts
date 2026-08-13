#!/usr/bin/env node
import { parseArgs } from "util";
import { existsSync } from "fs";
import { join } from "path";
import {
  newSession,
  loadSession,
  saveSession,
  saveChunk,
  appendLog,
  listSessions,
} from "../session/store.js";
import { loadTextFile } from "../session/fileSource.js";
import { runAgent, AgentResult } from "../session/agent.js";
import { createLLMClient } from "../llm/index.js";
import { renderMarkdown } from "../render/markdown.js";
import { writeFileSync } from "fs";

/**
 * CLI エントリポイント
 * サブコマンド:
 *   --new "<title>"            新規セッション作成
 *   --append <path>            チャンク追加 (LLM呼び出し → Zod検証 → Model更新)
 *   --render                   Markdown+Mermaid 出力
 *   --list                     セッション一覧
 *   --session <id>             操作対象セッション指定 (省略時は 最新)
 *
 * 環境変数:
 *   LLM_MODE=mock (デフォルト) | ollama
 *   OLLAMA_MODEL (デフォルト: llama3.1:8b)
 *   OLLAMA_BASE_URL (デフォルト: http://localhost:11434)
 *
 * ※ 従量課金APIは 一切実装しない。
 */

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      new: { type: "string" },
      append: { type: "string" },
      render: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      session: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (values.list) {
    cmdList();
    return;
  }

  if (typeof values.new === "string") {
    cmdNew(values.new);
    return;
  }

  if (typeof values.append === "string") {
    await cmdAppend(values.append, values.session as string | undefined);
    return;
  }

  if (values.render) {
    cmdRender(values.session as string | undefined);
    return;
  }

  // positionals fallback (e.g., forgot flag)
  if (positionals.length > 0) {
    console.error(`未知の引数: ${positionals.join(" ")}`);
  }
  printHelp();
}

function printHelp(): void {
  console.log(`
会議構造化エージェント CLI

【使い方】
  npm run session -- --new "<会議タイトル>"       新規セッション作成
  npm run session -- --append <ファイルパス>      チャンク追加
  npm run session -- --render                     Markdown+Mermaid 生成
  npm run session -- --list                       セッション一覧
  npm run session -- --session <id> --append ...  対象セッション指定

【環境変数】
  LLM_MODE=mock (デフォルト・課金ゼロ)
  LLM_MODE=ollama (ローカル推論・課金ゼロ)
    OLLAMA_MODEL=llama3.1:8b
    OLLAMA_BASE_URL=http://localhost:11434

※ 従量課金API (Anthropic/OpenAI等) は 実装していません。
`);
}

function cmdList(): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("(セッションはまだありません。--new で作成してください)");
    return;
  }
  console.log("セッション一覧 (更新順):");
  for (const s of sessions) {
    console.log(
      `  ${s.sessionId}  ${s.title}  [チャンク: ${s.processedChunkCount}]  更新: ${s.updatedAt}`
    );
  }
}

function cmdNew(title: string): void {
  const session = newSession(title);
  console.log(`✅ 新規セッション作成: ${session.meta.sessionId}`);
  console.log(`   タイトル: ${title}`);
  console.log(`   パス: ${session.path}`);
  console.log(``);
  console.log(`次のステップ: npm run session -- --append <文字起こしファイル>`);
}

async function cmdAppend(path: string, sessionId?: string): Promise<void> {
  if (!existsSync(path)) {
    console.error(`❌ ファイルが見つかりません: ${path}`);
    process.exit(1);
  }

  const session = loadSession(sessionId);
  console.log(`セッション: ${session.meta.sessionId} (${session.meta.title})`);

  const nextIndex = session.model.processedChunkIds.length + 1;
  const chunk = loadTextFile(path, { nextIndex });
  console.log(`チャンク: ${chunk.id} (${chunk.text.length}字)`);

  const llm = createLLMClient();
  console.log(`LLM: ${llm.name}`);
  console.log(`💰 課金: ${llm.isFree ? "なし (ゼロ円)" : "⚠️ 有料"}`);
  console.log(``);
  console.log(`🔴 ここから LLMに送信します...`);

  const result = await runAgent({
    llm,
    currentModel: session.model,
    chunkId: chunk.id,
    chunkText: chunk.text,
  });

  // ログ記録
  appendLog(session, {
    action: "append",
    chunkId: chunk.id,
    llm: llm.name,
    turns: result.turns,
    applied: result.applied,
    totalCostUsd: result.totalCostUsd,
  });

  // 表示
  console.log(``);
  printTurnSummary(result);

  if (!result.applied) {
    console.error(
      `\n⚠️ パッチ適用失敗。model.json は変更されていません。ログを確認してください。`
    );
    process.exit(2);
  }

  // チャンク保存 + processedChunkIds 追加 + セーブ
  saveChunk(session, chunk.id, chunk.text);
  const updated = {
    ...result.finalModel,
    processedChunkIds: [...result.finalModel.processedChunkIds, chunk.id],
  };
  const saved = saveSession(session, updated);
  console.log(``);
  printDiff(session.model, saved.model);
  console.log(``);
  console.log(`✅ 保存完了 (model.json 更新)`);
}

function cmdRender(sessionId?: string): void {
  const session = loadSession(sessionId);
  const md = renderMarkdown(session.model, session.meta);
  const outputPath = join(session.path, "outputs", "summary.md");
  writeFileSync(outputPath, md, "utf-8");
  console.log(`✅ Markdown+Mermaid 出力: ${outputPath}`);
  console.log(`   ステップ: ${session.model.steps.length}件`);
  console.log(`   未確定質問: ${session.model.openQuestions.length}件`);
}

// ============================================================
// 表示ヘルパー
// ============================================================

function printTurnSummary(result: AgentResult): void {
  result.turns.forEach((t) => {
    const status = t.validationOk ? "✅" : "❌";
    console.log(
      `  [Turn ${t.turn}] ${status} ${t.latencyMs}ms / パッチ${t.patchCount ?? 0}件` +
        ` / in ${t.inputTokens}tok / out ${t.outputTokens}tok / 💰 $${t.costUsd.toFixed(4)}`
    );
    if (!t.validationOk && t.errorSummary) {
      console.log(`     ↳ ${t.errorSummary.split("\n").slice(0, 3).join("\n     ")}`);
    }
  });
  console.log(`💰 このチャンク合計: $${result.totalCostUsd.toFixed(4)}`);
}

function printDiff(before: import("../schema/processModel.js").ProcessModel, after: import("../schema/processModel.js").ProcessModel): void {
  const newSteps = after.steps.filter((s) => !before.steps.some((b) => b.id === s.id));
  const newQs = after.openQuestions.filter(
    (q) => !before.openQuestions.some((b) => b.id === q.id)
  );
  const changedQs = after.openQuestions.filter((q) => {
    const b = before.openQuestions.find((x) => x.id === q.id);
    return b && (b.status !== q.status || b.category !== q.category);
  });

  console.log(`── 更新差分 ────────────────────────────`);
  newSteps.forEach((s) => {
    const mark =
      s.confidence === "confirmed" ? "✓" : s.confidence === "unknown" ? "⚠" : "~";
    const actor = s.actor ? ` [${s.actor}]` : "";
    console.log(`  + Step ${s.id} (${mark}${s.confidence}): ${s.label}${actor}`);
  });
  newQs.forEach((q) => {
    const mark = q.category === "conflict" ? "⚡矛盾" : "?未確定";
    console.log(`  + ${mark} ${q.id}: ${q.question}`);
    if (q.category === "conflict") {
      q.conflictingStatements.forEach((s) => {
        console.log(`      "${s.speaker ?? "?"}": ${s.claim.slice(0, 50)}`);
      });
    }
  });
  changedQs.forEach((q) => {
    if (q.category === "conflict") {
      console.log(`  ⚡ ${q.id} を conflict に昇格 (${q.conflictingStatements.length}人の発言記録)`);
      q.conflictingStatements.forEach((s) => {
        console.log(`      "${s.speaker ?? "?"}": ${s.claim.slice(0, 50)}`);
      });
    }
  });

  const openCount = after.openQuestions.filter((q) => q.status === "open").length;
  console.log(`\n? 未確定 累計: ${openCount}件 / ステップ累計: ${after.steps.length}件`);
}

main().catch((e) => {
  console.error(``);
  console.error(`❌ エラー: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
