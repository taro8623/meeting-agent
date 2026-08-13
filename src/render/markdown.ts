import { ProcessModel, Step, Edge } from "../schema/processModel.js";
import { SessionMeta } from "../session/store.js";

/**
 * ProcessModel を 単一の Markdown ファイルにレンダリング。
 * Mermaid フローチャートを コードブロックとして埋め込む。
 *
 * スタイル規則 (SPEC §4):
 *   - confirmed → 通常の実線ボックス
 *   - assumed   → 破線ボーダー、グレー
 *   - unknown   → 赤系、破線、ラベル末尾に ⚠
 *   - 未確定 edge → 点線矢印
 */
export function renderMarkdown(model: ProcessModel, meta: SessionMeta): string {
  const sections: string[] = [];

  sections.push(renderHeader(model, meta));
  sections.push(renderSummary(model));
  sections.push(renderAsIsDiagram(model));

  const toBeSteps = model.steps.filter((s) => s.phase === "to_be");
  if (toBeSteps.length > 0) {
    sections.push(renderToBeDiagram(model));
  }

  sections.push(renderConfirmedStepsTable(model));
  sections.push(renderOpenQuestions(model));
  sections.push(renderFooter());

  return sections.join("\n\n---\n\n");
}

// ============================================================
// セクション
// ============================================================

function renderHeader(model: ProcessModel, meta: SessionMeta): string {
  return `# ${meta.title}

- **セッションID**: \`${meta.sessionId}\`
- **作成日時**: ${meta.createdAt}
- **最終更新**: ${model.updatedAt}
- **処理チャンク数**: ${model.processedChunkIds.length}件`;
}

function renderSummary(model: ProcessModel): string {
  const confirmed = model.steps.filter((s) => s.confidence === "confirmed").length;
  const unknown = model.steps.filter((s) => s.confidence === "unknown").length;
  const assumed = model.steps.filter((s) => s.confidence === "assumed").length;
  const openQs = model.openQuestions.filter((q) => q.status === "open").length;
  const answered = model.openQuestions.filter((q) => q.status === "answered").length;
  const conflicts = model.openQuestions.filter((q) => q.category === "conflict").length;

  return `## サマリー

| 項目 | 件数 |
|---|---|
| ✅ 確定ステップ | ${confirmed} |
| ⚠️ 未確定ステップ (要確認) | ${unknown} |
| ➖ 推定ステップ | ${assumed} |
| ❓ 未解決の質問 | ${openQs} |
| ✔️ 解決済みの質問 | ${answered} |
| ⚡ 参加者間の矛盾 | ${conflicts} |

**このドキュメントの読み方**:
- Mermaid図の赤破線ボックス (⚠) は「発言に明示されていない未確定事項」です
- 「未解決の質問」セクションが 次回会議で優先的に潰すべき論点です
- 参加者の発言が矛盾したものは 削除せず 両論併記しています`;
}

function renderAsIsDiagram(model: ProcessModel): string {
  const asIsSteps = model.steps.filter((s) => s.phase === "as_is");
  const asIsEdges = model.edges.filter((e) => {
    const from = asIsSteps.find((s) => s.id === e.from);
    const to = asIsSteps.find((s) => s.id === e.to);
    return from && to;
  });
  const mermaid = buildMermaidFlowchart(asIsSteps, asIsEdges);
  return `## 現状 (As-Is) 業務フロー

\`\`\`mermaid
${mermaid}
\`\`\``;
}

function renderToBeDiagram(model: ProcessModel): string {
  const toBeSteps = model.steps.filter((s) => s.phase === "to_be");
  const toBeEdges = model.edges.filter((e) => {
    const from = toBeSteps.find((s) => s.id === e.from);
    const to = toBeSteps.find((s) => s.id === e.to);
    return from && to;
  });
  const mermaid = buildMermaidFlowchart(toBeSteps, toBeEdges);
  return `## 将来 (To-Be) 業務フロー

\`\`\`mermaid
${mermaid}
\`\`\``;
}

function renderConfirmedStepsTable(model: ProcessModel): string {
  const confirmed = model.steps.filter((s) => s.confidence === "confirmed");
  if (confirmed.length === 0) return "";
  const rows = confirmed.map((s) => {
    const src = s.sources[0];
    const evidence = src
      ? `${src.speaker ?? "?"}「${src.quote}」(${src.chunkId})`
      : "-";
    return `| ${s.id} | ${escapeCell(s.label)} | ${s.actor ?? "-"} | ${escapeCell(evidence)} |`;
  });
  return `## 確定した業務ステップ (根拠発言付き)

| ID | ステップ | 実施者 | 根拠となる発言 |
|---|---|---|---|
${rows.join("\n")}`;
}

function renderOpenQuestions(model: ProcessModel): string {
  const open = model.openQuestions.filter((q) => q.status === "open");
  const answered = model.openQuestions.filter((q) => q.status === "answered");
  if (open.length === 0 && answered.length === 0) return "";

  const parts: string[] = ["## 未解決の質問 (次回会議で確認)"];

  if (open.length === 0) {
    parts.push("_未解決の質問はありません_");
  } else {
    for (const q of open) {
      parts.push(renderQuestion(q));
    }
  }

  if (answered.length > 0) {
    parts.push("\n### 解決済み");
    for (const q of answered) {
      parts.push(
        `- **${q.id}**: ${q.question}\n  → 回答: ${q.answer ?? "-"} (${q.answeredAt ?? ""})`
      );
    }
  }

  return parts.join("\n\n");
}

function renderQuestion(q: import("../schema/processModel.js").OpenQuestion): string {
  const catLabel =
    q.category === "conflict"
      ? "⚡ **矛盾**"
      : q.category === "actor"
        ? "👤 実施者"
        : q.category === "trigger"
          ? "⏰ 発生条件"
          : q.category === "branch"
            ? "🔀 分岐条件"
            : q.category === "system"
              ? "🖥️ 使用システム"
              : "❓ その他";

  const lines = [`### ${q.id}: ${q.question}`, `- 分類: ${catLabel}`];
  if (q.relatedStepIds.length > 0) {
    lines.push(`- 関連ステップ: ${q.relatedStepIds.map((id) => `\`${id}\``).join(", ")}`);
  }
  lines.push(`- 起票時のチャンク: \`${q.raisedAtChunk}\``);

  if (q.category === "conflict" && q.conflictingStatements.length > 0) {
    lines.push("- **参加者間の矛盾する発言 (両論併記)**:");
    for (const s of q.conflictingStatements) {
      lines.push(
        `  - **${s.speaker ?? "?"}**: ${s.claim}\n    > 「${s.source.quote}」(${s.source.chunkId})`
      );
    }
  }

  return lines.join("\n");
}

function renderFooter(): string {
  return `## この文書の生成について

- 本文書は 会議文字起こしから **ProcessModel (JSON)** を構築し、
  Zod \`superRefine\` の4制約 (推測禁止・sources必須・矛盾両論併記・edge整合性) を
  すべて通過した結果を Markdown+Mermaid にレンダリングしたものです。
- 生成過程で LLM を使用していますが、**Ollama (ローカル) または Mock** のみで、
  外部API (Anthropic/OpenAI等) には一切送信していません。
- 業務データの機密性を優先する設計です。`;
}

// ============================================================
// Mermaid ビルダー
// ============================================================

function buildMermaidFlowchart(steps: Step[], edges: Edge[]): string {
  if (steps.length === 0) {
    return "flowchart TD\n  empty[まだステップがありません]";
  }

  const lines: string[] = ["flowchart TD"];

  // ノード定義
  for (const step of steps) {
    lines.push(`  ${nodeDefinition(step)}`);
  }

  // エッジ定義
  for (const edge of edges) {
    lines.push(`  ${edgeDefinition(edge)}`);
  }

  // クラス定義 (色分け)
  lines.push("");
  lines.push("  classDef confirmed fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20");
  lines.push("  classDef assumed fill:#eeeeee,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray: 5 5,color:#424242");
  lines.push("  classDef unknown fill:#ffebee,stroke:#c62828,stroke-width:2px,stroke-dasharray: 5 5,color:#b71c1c");

  // ノードごとの class付与
  const byClass = { confirmed: [] as string[], assumed: [] as string[], unknown: [] as string[] };
  for (const step of steps) {
    byClass[step.confidence].push(step.id);
  }
  for (const [cls, ids] of Object.entries(byClass)) {
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(",")} ${cls}`);
    }
  }

  return lines.join("\n");
}

function nodeDefinition(step: Step): string {
  const marker = step.confidence === "unknown" ? " ⚠" : "";
  const actor = step.actor ? `<br/><small>${escapeMermaid(step.actor)}</small>` : "";
  const label = `${escapeMermaid(step.label)}${marker}${actor}`;
  return `${step.id}["${label}"]`;
}

function edgeDefinition(edge: Edge): string {
  const arrow = edge.confidence === "unknown" ? "-.->" : "-->";
  const label = edge.label ? `|"${escapeMermaid(edge.label)}"|` : "";
  return `${edge.from} ${arrow}${label} ${edge.to}`;
}

// ============================================================
// エスケープ
// ============================================================

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeMermaid(s: string): string {
  // Mermaid ノードラベル内で問題を起こす文字
  return s.replace(/"/g, "'").replace(/\n/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
