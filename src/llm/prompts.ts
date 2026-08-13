import { ProcessModel } from "../schema/processModel.js";

/**
 * システムプロンプト — SPEC §8「システムプロンプトの必須事項」を全て含む。
 *
 * 重要方針:
 * 1. 推測禁止 (発言に明示されていない情報を埋めない)
 * 2. 不明は confidence=unknown + OpenQuestion 起票を強制
 * 3. 矛盾は片方選ばず conflictingStatements に両方記録
 * 4. 各 Step に発言引用 sources を含める
 */
export const SYSTEM_PROMPT = `あなたは医療機関の要件定義会議の議事録を構造化するエージェントです。
会議の文字起こしから、業務プロセス (Step / Edge) と 未確定事項 (OpenQuestion) を抽出し、
apply_process_patch ツールを 1回だけ呼び出してください。

# 絶対に守るルール

## ルール1: 推測禁止
発言に明示されていない情報を推測で埋めることを厳格に禁じます。
「普通は承認があるはず」「たぶんこの人がやる」などの一般常識からの補完も禁止です。
不明な情報は必ず confidence="unknown" とし、対応する OpenQuestion を必ず起票します。

## ルール2: unknown Step には OpenQuestion 必須
新規追加する Step で confidence="unknown" のものがあれば、
その Step の id を relatedStepIds に含む OpenQuestion を 同じパッチで必ず追加してください。
(Zodバリデーションで検出され、パッチが拒否されます)

## ルール3: confirmed Step には sources 必須
confidence="confirmed" の Step には、発言引用の sources を最低1件必ず含めてください。
根拠となる発言 (誰が / いつ / 何と言ったか) を quote に200字以内で記録します。

## ルール4: 参加者間の矛盾を握りつぶさない
複数の参加者が異なることを言った場合、どちらか一方を選んで確定にせず、
category="conflict" の OpenQuestion を起票 (または既存質問を update) し、
conflictingStatements に両方 (または全て) の発言を必ず記録してください。
statements は最低2件必要です。

## ルール5: Step ID は連番
既に存在する Step の最大id + 1 から連番で id を発行してください。
(既存 s1〜s7 があれば、新規は s8 から)。OpenQuestion も同様に q1, q2, ...

# 出力形式

必ず apply_process_patch ツールを 1回呼び出してください。
文章での説明は不要です。ツール呼び出しだけを返してください。

# few-shot 例

## 良い例: 曖昧発言を unknown で登録
発言: 田中「実績登録は… ちょっと私も細かい運用は把握しきれていないんですが、たぶん誰かがどこかに入れているはずです」
→ 正しい出力:
{
  "patches": [
    { "op": "add_step", "step": {
      "id": "s9", "label": "滅菌完了後の実績登録",
      "actor": null, "system": null, "phase": "as_is",
      "confidence": "unknown", "sources": []
    }},
    { "op": "add_question", "question": {
      "id": "q1", "question": "滅菌完了後の実績登録は 誰が どのシステムに 行うか",
      "relatedStepIds": ["s9"], "category": "actor",
      "conflictingStatements": [], "status": "open",
      "answer": null, "answeredAt": null, "raisedAtChunk": "chunk_002"
    }}
  ]
}

## 悪い例: 推測で埋める (これは禁止)
{ "step": { "id": "s9", "label": "実績登録", "actor": "看護師",  ← 発言に「看護師」とないのに補完している
            "confidence": "confirmed" }}

## 良い例: 参加者の矛盾を conflict として記録
発言: 田中「看護師が入力するはず」/ 佐藤「いや中材の担当者ですよ」
→ 正しい出力: (質問q1が既に起票済みなら flag_conflict、初回なら add_question with category=conflict)
`;

/**
 * ユーザーメッセージを組み立てる。
 * SPEC §5「LLMへの入力: 現在の ProcessModel + 直近チャンクのテキスト のみ」
 */
export function buildUserMessage(
  currentModel: ProcessModel,
  chunkId: string,
  chunkText: string
): string {
  const nextStepId = getNextId(currentModel.steps.map((s) => s.id), "s");
  const nextQuestionId = getNextId(
    currentModel.openQuestions.map((q) => q.id),
    "q"
  );

  return `# 現在の ProcessModel (これに対する差分パッチを提出してください)

\`\`\`json
${JSON.stringify(
  {
    steps: currentModel.steps.map((s) => ({
      id: s.id,
      label: s.label,
      confidence: s.confidence,
    })),
    openQuestions: currentModel.openQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      status: q.status,
      category: q.category,
    })),
  },
  null,
  2
)}
\`\`\`

# 次に発行すべき ID
- Step の次: **${nextStepId}** (これ以降 s${extractNum(nextStepId)}, s${extractNum(nextStepId) + 1}, ...)
- Question の次: **${nextQuestionId}**

# 追加する文字起こし (chunkId = "${chunkId}")

\`\`\`
${chunkText}
\`\`\`

# 指示
上記の発言だけから、apply_process_patch を1回呼び出してください。
- sources の chunkId には必ず "${chunkId}" を使う
- 各パッチに含める Step / Question の id は上記「次に発行すべき ID」から連番
- 推測禁止・不明は unknown + OpenQuestion 起票
- 矛盾は conflictingStatements に両論併記`;
}

function getNextId(existingIds: string[], prefix: string): string {
  const nums = existingIds
    .map((id) => {
      const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
      return m ? parseInt(m[1]!, 10) : 0;
    })
    .filter((n) => n > 0);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}${max + 1}`;
}

function extractNum(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? parseInt(m[1]!, 10) : 1;
}

/**
 * Zodバリデーション失敗時のリトライメッセージ (エージェントループ2ターン目)
 * SPEC §8「バリデーションエラーは LLMにそのまま返し、自己修正させる」
 */
export function buildRetryMessage(errorSummary: string): string {
  return `直前の apply_process_patch はバリデーション失敗しました。

# エラー内容

${errorSummary}

# 修正指示

上記エラーを解消するパッチを 1回だけ再提出してください。
- 特に unknown Step には対応する OpenQuestion を必ず追加
- confirmed Step には sources を最低1件
- conflict OpenQuestion は conflictingStatements 2件以上
- Edge の from/to は 既存 Step id を参照

再度 apply_process_patch を1回呼び出してください。`;
}
