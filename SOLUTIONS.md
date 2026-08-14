# 解答集 — 課題要件と実装の 逐条マッピング

> 課題文の各項目に対して、**実装のどこ (ファイル + 行番号) で対応しているか** / **どのテストで検証しているか** / **自己採点** をまとめた対応表。
> 提出時に README とセットで確認できるよう作成。

---

## 目次

1. [課題文「実装品質」への対応](#1-課題文実装品質への対応)
2. [課題文「実務投入の現実性」への対応](#2-課題文実務投入の現実性への対応)
3. [課題文「READMEに必ず書くこと」への対応](#3-課題文readmeに必ず書くことへの対応)
4. [課題文「向いている題材」への該当](#4-課題文向いている題材への該当)
5. [独自の追加価値 (差別化ポイント)](#5-独自の追加価値-差別化ポイント)
6. [自己採点サマリー](#6-自己採点サマリー)

---

## 1. 課題文「実装品質」への対応

課題文 (IMG_3406) の 5 項目に対する 対応:

### 1-1. TypeScriptの型が適切に使われているか  ◎

| 対応内容 | ファイル・行 |
|---|---|
| `strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` | `tsconfig.json:6-12` |
| ドメイン型を Zod で定義 (二重管理を防ぐ) | `src/schema/processModel.ts:1-70` |
| Discriminated Union で Patch を型安全化 | `src/llm/tools.ts:19-42` |
| Interface で LLM 実装を抽象化 | `src/llm/types.ts:47-56` |
| any / as 型キャストを避けた実装 | 全域 (grep で `as any` 0 件) |

**検証**: `npm test` (55 件全パス) / `npm run build` (tsc エラーなし)

---

### 1-2. 小さな関数・モジュールに分割されているか  ◎

| モジュール | 責務 | 行数 |
|---|---|---|
| `src/schema/processModel.ts` | ドメイン型 + Zod 制約 | 148 |
| `src/llm/types.ts` | LLM 抽象 interface | 65 |
| `src/llm/MockClient.ts` | Mock 実装 | 87 |
| `src/llm/OllamaClient.ts` | Ollama HTTP 実装 | 157 |
| `src/llm/tools.ts` | Tool 定義 | 221 |
| `src/llm/prompts.ts` | プロンプト構築 | 168 |
| `src/session/agent.ts` | エージェントループ | 175 |
| `src/session/patcher.ts` | パッチ適用+Zod検証 | 176 |
| `src/session/store.ts` | ファイル永続化 | 183 |
| `src/session/fileSource.ts` | チャンク読込 | 48 |
| `src/render/markdown.ts` | Markdown+Mermaid | 253 |
| `src/cli/session.ts` | CLI エントリ | 257 |

**責務が縦割り** (Schema → LLM → Session → Render → CLI の順に依存)。循環依存なし。

---

### 1-3. セットアップ手順通りに動かせるか  ◎

`README.md` の「セットアップ手順」に記載:

```bash
git clone <このリポジトリ>
cd meeting-agent
npm install
npm test                                        # 55件全パス
npm run session -- --new "デモ会議"
npm run session -- --append data/sample/chunk_01.txt
npm run session -- --render
open ~/.local/share/meeting-agent/sessions/*/outputs/summary.md
```

**API キー不要 / 追加インストール不要 / ネット不要** (Mock モード時)。

**検証済み**: 実行ログ `~/.local/share/meeting-agent/sessions/<session-id>/` に残る (XDG Base Directory Specification 準拠)。

---

### 1-4. APIキーや個人情報をリポジトリに含めていないか  ◎

| 対応 | 内容 |
|---|---|
| `.env` に相当するファイル | **存在しない** (API キーが不要な設計) |
| `.gitignore` | `node_modules/`, `dist/`, `.sessions/` (下位互換用), `.env`, `.env.local`, `*.log`, `.DS_Store`, `coverage/` |
| セッションデータの保存先 | XDG Base Directory 準拠 (`~/.local/share/meeting-agent/sessions/`)。リポ内には一切保存しない |
| 従量課金 SDK | **導入なし** (`@anthropic-ai/sdk`, `openai` パッケージ 0 個) |
| ダミー文字起こしの匿名化 | 「A病院」に完全抽象化 / 参加者は仮名 (田中/佐藤/鈴木/伊藤) |

**検証**: `git status --ignored` で .env 系ファイルが 全て ignored、`grep -r "sk-" src` で 0 件。

---

### 1-5. 最低限のテストまたは動作確認手順があるか  ◎

**Vitest 55 件 全パス**:

| テストファイル | 件数 | 何を検証 |
|---|---|---|
| `src/schema/processModel.test.ts` | 27 | Zod superRefine 4 制約 (成功/失敗ケース網羅) |
| `src/__tests__/mockResponses.test.ts` | 9 | Mock 応答が Zod 制約を全て満たす |
| `src/llm/MockClient.test.ts` | 6 | Mock クライアントの契約 |
| `src/__tests__/agent.test.ts` | 6 | 2 ターン制限のエージェントループ (成功/失敗/リトライ) |
| `src/render/markdown.test.ts` | 7 | Markdown+Mermaid 出力 (エスケープ含む) |

**テストは Ollama も外部 API も呼びません**。`npm test` 単独で完結、CI で常時無料。

動作確認手順は README「セットアップ手順」に 5 コマンドで記載。

---

## 2. 課題文「実務投入の現実性」への対応

課題文 (IMG_3406) の 5 項目に対する 対応:

### 2-1. ログや再実行の考慮があるか  ◎

| 対応内容 | ファイル・行 |
|---|---|
| JSONL 形式で 実行トレースを保存 | `src/session/store.ts:126-134` (`appendLog`) |
| CLI 実行ごとに全 turn のログ記録 | `src/cli/session.ts:143-153` |
| model.json 書き込み前に自動バックアップ | `src/session/store.ts:105-107` |
| セッションIDで完全隔離 (別セッションを壊さない) | `~/.local/share/meeting-agent/sessions/<id>/` (XDG準拠) |
| チャンクは chunks/ に元テキストごと保存 (再実行可) | `src/session/store.ts:118-125` (`saveChunk`) |

**ログ形式例** (`~/.local/share/meeting-agent/sessions/<id>/logs/run_2026-08-07.jsonl`):

```jsonl
{"timestamp":"...","action":"append","chunkId":"chunk_001","llm":"MockClient (課金ゼロ)","turns":[{"turn":1,"latencyMs":0,"inputTokens":0,"outputTokens":0,"costUsd":0,"toolCallName":"apply_process_patch","patchCount":13,"validationOk":true}],"applied":true,"totalCostUsd":0}
```

- `costUsd` を常時記録 (Ollama/Mock は常に 0、将来他モデル追加時も追跡)
- `validationOk` で Zod 検証成否がすぐ分かる
- `turns` 配列で 2 ターン走ったケースも 明示的に記録

---

### 2-2. コスト・レイテンシ・失敗時の挙動を説明できるか  ◎

**コスト**:
- Mock: 常に $0 (`src/llm/MockClient.ts:22`, `isFree = true`)
- Ollama: 常に $0 (`src/llm/OllamaClient.ts:59`, `isFree = true`, ローカル推論)
- 従量課金 API: **実装ゼロ** (README「使用した LLM API と選定理由」で明示)

**レイテンシ**:
- 各 turn の `latencyMs` をログ記録 (`src/llm/types.ts:20`)
- Ollama タイムアウト: デフォルト 120 秒 (`src/llm/OllamaClient.ts:62`)
- CLI 実行時に turn 単位で表示 (`src/cli/session.ts:181-192`)

**失敗時の挙動** (README「エラーハンドリング方針」参照):
- Zod バリデーション失敗 → LLM に返して 1 回だけリトライ → 再失敗で 元 Model 維持で安全終了
- Ollama 接続失敗 (`ECONNREFUSED`) → 明示的なエラーメッセージ (`src/llm/OllamaClient.ts:113-116`)
- Ollama タイムアウト → 明示的な警告 (`src/llm/OllamaClient.ts:108-111`)
- ファイル不正 → 拒否メッセージ (`src/session/fileSource.ts:24-35`)
- CLI 終了コード: `0` 正常 / `1` 一般エラー / `2` パッチ適用失敗

---

### 2-3. 人間の承認が必要な箇所を切り分けているか  ◎

**エージェントの自動処理範囲** と **人間承認箇所** の切り分けを 型と CLI 出力で明確化:

| フェーズ | 主体 | 実装場所 |
|---|---|---|
| 発言からの Step / OpenQuestion 抽出 | LLM (自動) | `src/session/agent.ts:runAgent` |
| Zod 制約による検証 | エージェント (自動) | `src/session/patcher.ts:applyPatchesAndValidate` |
| パッチ適用の可否 | エージェント (2ターン制限、自動) | `src/session/agent.ts:62-102` |
| **未確定事項 (OpenQuestion) の解決** | **人間 (病院担当者)** | 将来拡張 `--import-answers` |
| **conflict 判定後の 正解の採用** | **人間 (次回会議で確認)** | 将来拡張 |
| **model.json の最終承認** | **人間 (レビュー後 git commit)** | 運用手順 |

**設計思想**: エージェントは「わからないことを勝手に埋めない」+「矛盾を勝手に片方に決めない」ことで、
**人間承認が必要な論点をリストアップする**役割に徹する。判断は人間。

---

### 2-4. 追加開発なしで本番運用に近づけられる見通しがあるか  ○

**現状で本番に近い部分**:
- CLI 完結 (Web UI 不要)
- ファイルベース永続化 (DB 不要)
- ローカル LLM 対応 (病院内クローズド環境で動作可)
- 監査ログ (JSONL) 自動記録
- API キー不要 (情報統制ポリシーとの摩擦なし)

**本番投入に向けて追加が必要な項目** (README「実務投入するなら次に改善すること」に明記):
- QA シート往復 (`--import-answers`) — 病院との Excel 往復ワークフロー
- Ollama モデルの精度チューニング (llama3.1:8b でのツール呼び出し安定性計測)
- 話者分離の高度化
- 用語辞書の追加

**「追加開発なしで本番運用に近づけられるか?」への回答**:
> "現状のまま社内 PoC / 少数案件のパイロット運用は可能。
> 本格導入には QA シート往復と 話者分離の追加が必要 (SPEC 原文で削減した機能)。
> BYOK (Bring Your Own Key) 型 SaaS への拡張も 抽象化層のおかげで低コストで実現可能。"

---

## 3. 課題文「READMEに必ず書くこと」への対応

課題文 (IMG_3407) の 11 項目に対する 対応:

| # | 課題項目 | README 該当セクション |
|---|---|---|
| 1 | 何をするエージェントか | 「何をするエージェントか」 |
| 2 | 想定ユーザーと業務シナリオ | 「想定ユーザーと業務シナリオ」 |
| 3 | セットアップ手順 | 「セットアップ手順」 |
| 4 | 必要な環境変数 | 「必要な環境変数」 |
| 5 | 実行方法 | 「実行方法」 |
| 6 | アーキテクチャ図または構成説明 | 「アーキテクチャ」(ASCII 図) |
| 7 | 使用した LLM API と選定理由 | 「使用した LLM API と選定理由」 |
| 8 | ツール一覧と各ツールの役割 | 「ツール一覧と各ツールの役割」 |
| 9 | うまくいく入力例 / 苦手な入力例 | 「うまくいく入力例 / 苦手な入力例」 |
| 10 | エラーハンドリング方針 | 「エラーハンドリング方針」 |
| 11 | 実務投入するなら次に改善すること | 「実務投入するなら次に改善すること」(短期/中期/長期) |

**全 11 項目網羅済み** ✅

README 単独で再現できる状態 (キャッチアップ〜動作確認〜評価が README だけで完結)。

---

## 4. 課題文「向いている題材」への該当

課題文 (IMG_3404 / IMG_3405) で示された「向いている題材」との照合:

### IMG_3404 (例2: Web受付+承認)

> ユーザーがWeb画面で入力や候補確認を行い、
> エージェントが裏側で情報収集・判定・
> 下書き生成を行う構成です。人間の承認を挟む
> 業務に向いています。

**該当度**: ◎

- Web UI ではなく CLI だが、**「人間の承認を挟む業務」の構造** は完全に一致
- エージェントが裏側で 発言抽出・構造化・矛盾検出を行う
- 未確定事項・矛盾事項の**判定と決定は 人間 (病院担当者) が承認**する設計

### IMG_3405 (例3: ChatOps型)

> チャット上の自然言語指示を受け、必要な情
> 報を取得して短い成果物を返す構成です。実
> 際のチーム運用に近い体験を作れます。

**該当度**: ○ (部分的に該当)

- CLI 経由で 自然言語 (会議文字起こし) を受けて 短い成果物 (差分表示・Markdown) を返す
- Slack / Discord ではなく CLI (MVP のため意図削減)
- 将来拡張として Teams / Slack 連携が README に記載

---

## 5. 独自の追加価値 (差別化ポイント)

課題文に明示されていないが、**単発プロンプト との差別化** として実装:

### 5-1. Zod superRefine で LLM 出力を強制検証

| 制約 | 実装場所 | 意義 |
|---|---|---|
| 制約1: unknown Step → OpenQuestion 必須 | `src/schema/processModel.ts:105-118` | 「わからない」を型で強制 |
| 制約2: confirmed Step → sources 必須 | `src/schema/processModel.ts:94-104` | 「確定と言うなら発言引用」を強制 |
| 制約3: conflict Question → statements 2件以上 | `src/schema/processModel.ts:120-131` | 「矛盾を片方に丸めない」を強制 |
| 制約4: Edge → 既存 Step 参照 | `src/schema/processModel.ts:76-93` | 整合性チェック |

**LLM がプロンプト指示を無視して推測で埋めても、保存時に必ず落ちる**。
これが「プロンプト版との本質的な違い」の中核。

### 5-2. SourceRef による発言追跡性

各 Step / conflictingStatement に `SourceRef` (`chunkId` + `speaker` + `quote`) が
**型的に必須**。「なぜこの Step が確定と判断されたか」を 発言元まで遡れる。

`src/schema/processModel.ts:6-11` (SourceRef 型定義)

### 5-3. 過去の蓄積を破壊しないパッチ設計

`apply_process_patch` には **削除操作を提供しない** (`src/llm/tools.ts:19-42`)。
LLM が誤解して既存ステップを消すことを **仕組みで不可能に**している。

さらに 2 ターンとも失敗した場合、**元 Model を維持して安全終了**
(`src/session/agent.ts:101-108`)。ユーザーの過去の蓄積を絶対に壊さない。

### 5-4. 完全な情報統制対応

- 従量課金 API 実装ゼロ (`grep -r "anthropic\|openai" src/` = 0 件)
- ローカル LLM (Ollama) で完結
- 医療データが外部に送信されない → PMDA / 個情法対応で有利
- API キー不要でリポジトリに機密なし

---

## 6. 自己採点サマリー

### 実装品質 (5項目)

| 項目 | 自己採点 | コメント |
|---|---|---|
| TypeScript の型 | ◎ | strict + Zod + Discriminated Union で二重防御 |
| モジュール分割 | ◎ | 12 モジュール、責務の縦割り、循環依存なし |
| セットアップ手順 | ◎ | 5 コマンドで完結、API キー不要 |
| APIキー・個人情報 | ◎ | 設計から排除 (SDK 0 個) |
| テスト・動作確認 | ◎ | Vitest 55 件全パス + CLI E2E 手順記載 |

### 実務投入の現実性 (5項目)

| 項目 | 自己採点 | コメント |
|---|---|---|
| ログ・再実行 | ◎ | JSONL 自動記録、model.json 自動バックアップ |
| コスト・レイテンシ・失敗時 | ◎ | コスト常時 $0、latencyMs 記録、Zod 失敗は 2 ターン設計 |
| 人間承認の切り分け | ◎ | エージェント=構造化のみ、判断は人間 |
| 追加開発なしで本番運用 | ○ | 社内 PoC は現状で可、本格導入は QA シート往復追加が必要 |

### READMEに必ず書くこと (11項目)

**全項目網羅** ✅ (§3 の対応表参照)

### 総合評価

- **必須要件**: 全て満たす
- **削減仕様の明示**: README に理由と将来拡張として明記
- **差別化**: Zod superRefine + SourceRef + 過去蓄積保護 の 3 点で
  「単なるプロンプト」との違いを型と設計で示せた

---

## 提出時のアピールポイント (口頭説明用 3 点)

1. **「わからない」が型で強制される**
   → 単発プロンプトでは滑らかな文章に埋もれる情報が、
   Zod superRefine で **保存時に必ず検出** される。
   これは プロンプトエンジニアリングだけでは実現できない設計。

2. **医療データを外部に送信しないアーキテクチャ**
   → 従量課金 API を意図的に排除。
   Ollama (ローカル LLM) + Mock の 2 実装で 完全ローカル動作。
   医療業界の情報統制ポリシーと相性が良い設計。

3. **過去の蓄積を絶対に壊さない**
   → `apply_process_patch` に削除操作を提供しない +
   バリデーション失敗時は元 Model を維持で安全終了。
   運用中に「壊れた」経験を作らない設計。

---

**この解答集について**: 本ファイルは 課題文の各項目に対する 実装対応を
逐条で示すためのもの。実装本体は README.md と src/ を参照。
