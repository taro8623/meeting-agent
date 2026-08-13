import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";
import { emptyProcessModel } from "../schema/processModel.js";

const meta = {
  sessionId: "test",
  title: "デモ会議",
  createdAt: "2026-08-07T00:00:00Z",
  updatedAt: "2026-08-07T01:00:00Z",
  processedChunkCount: 0,
};

describe("renderMarkdown", () => {
  it("空Modelでも 有効なMarkdownを返す (Mermaid空フローチャート含む)", () => {
    const model = emptyProcessModel("test", "デモ会議");
    const md = renderMarkdown(model, meta);
    expect(md).toContain("# デモ会議");
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart TD");
  });

  it("confirmed Step を含むと Mermaidにノード出力される", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      steps: [
        {
          id: "s1",
          label: "手術後の器材回収",
          actor: "看護師",
          system: null,
          phase: "as_is" as const,
          confidence: "confirmed" as const,
          sources: [
            {
              chunkId: "chunk_001",
              speaker: "田中",
              timestamp: null,
              quote: "手術後 器材を回収します",
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    expect(md).toContain("s1[");
    expect(md).toContain("手術後の器材回収");
    expect(md).toContain("class s1 confirmed");
    expect(md).toContain("田中");
    expect(md).toContain("確定した業務ステップ");
  });

  it("unknown Step は赤破線クラス + ⚠ が付く", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      steps: [
        {
          id: "s1",
          label: "実績登録",
          actor: null,
          system: null,
          phase: "as_is" as const,
          confidence: "unknown" as const,
          sources: [],
        },
      ],
      openQuestions: [
        {
          id: "q1",
          question: "誰が入力?",
          relatedStepIds: ["s1"],
          category: "actor" as const,
          conflictingStatements: [],
          status: "open" as const,
          answer: null,
          answeredAt: null,
          raisedAtChunk: "chunk_001",
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    expect(md).toContain("class s1 unknown");
    expect(md).toContain("⚠");
    expect(md).toContain("classDef unknown");
  });

  it("conflict OpenQuestion は 両論併記で出力される", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      openQuestions: [
        {
          id: "q1",
          question: "実績登録は誰?",
          relatedStepIds: [],
          category: "conflict" as const,
          conflictingStatements: [
            {
              speaker: "田中",
              claim: "看護師が入力",
              source: {
                chunkId: "chunk_003",
                speaker: "田中",
                timestamp: null,
                quote: "看護師が入力するはず",
              },
            },
            {
              speaker: "佐藤",
              claim: "中材の担当が入力",
              source: {
                chunkId: "chunk_003",
                speaker: "佐藤",
                timestamp: null,
                quote: "中材の担当者ですよ",
              },
            },
          ],
          status: "open" as const,
          answer: null,
          answeredAt: null,
          raisedAtChunk: "chunk_003",
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    expect(md).toContain("⚡");
    expect(md).toContain("両論併記");
    expect(md).toContain("看護師が入力するはず");
    expect(md).toContain("中材の担当者ですよ");
    expect(md).toContain("田中");
    expect(md).toContain("佐藤");
  });

  it("to_be Step があれば To-Beセクションを出力", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      steps: [
        {
          id: "s1",
          label: "パス自動発行",
          actor: "電子カルテ",
          system: null,
          phase: "to_be" as const,
          confidence: "confirmed" as const,
          sources: [
            {
              chunkId: "chunk_003",
              speaker: "佐藤",
              timestamp: null,
              quote: "10月から自動発行",
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    expect(md).toContain("将来 (To-Be) 業務フロー");
  });

  it("Mermaid ノード内の 引用符 が エスケープされる", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      steps: [
        {
          id: "s1",
          label: 'ラベル内に"引用符"あり',
          actor: null,
          system: null,
          phase: "as_is" as const,
          confidence: "confirmed" as const,
          sources: [
            {
              chunkId: "chunk_001",
              speaker: "田中",
              timestamp: null,
              quote: "テスト",
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    // Mermaid ブロックを抽出
    const mermaidBlock = md.match(/```mermaid\n([\s\S]*?)\n```/)?.[1] ?? "";
    // Mermaid内では " が ' に置換されている
    expect(mermaidBlock).toContain("ラベル内に'引用符'あり");
    expect(mermaidBlock).not.toContain('ラベル内に"引用符"あり');
  });

  it("表セル内の | (パイプ) がエスケープされる", () => {
    const model = {
      ...emptyProcessModel("test", "デモ"),
      steps: [
        {
          id: "s1",
          label: "A|B|C",
          actor: null,
          system: null,
          phase: "as_is" as const,
          confidence: "confirmed" as const,
          sources: [
            {
              chunkId: "chunk_001",
              speaker: "田中",
              timestamp: null,
              quote: "テスト",
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(model, meta);
    expect(md).toContain("A\\|B\\|C");
  });
});
