import { readFileSync } from "fs";
import { join } from "path";
import { LLMClient, CallRequest, LLMResponse, ToolCall } from "./types.js";

/**
 * Mock LLMクライアント — 課金ゼロ・オフライン動作。
 *
 * 動作:
 * - ユーザーメッセージから chunkId を正規表現で抽出
 * - data/sample/mock_responses.json から対応する応答を返す
 * - 該当なしなら「空のパッチ配列」を返す (エラーではなく、実装の柔軟性のため)
 *
 * これにより 開発中・テスト中・デモ中 は 一切API課金なしで
 * 全機能を検証できる。
 */

interface MockResponseFile {
  [chunkId: string]: {
    toolName: string;
    patches: unknown[];
  };
}

export class MockClient implements LLMClient {
  readonly name = "MockClient (課金ゼロ)";
  readonly isFree = true;

  constructor(private readonly responsesPath?: string) {}

  async call(request: CallRequest): Promise<LLMResponse> {
    const start = Date.now();

    const userMsg =
      request.messages.filter((m) => m.role === "user").slice(-1)[0]?.content ??
      "";
    const chunkId = extractChunkId(userMsg);

    // リトライメッセージ (Zodバリデーション失敗後の2ターン目) を検出したら
    // 敢えて 修正版パッチ を返す代わりに、空を返して安全終了させる。
    // (Mock は "最初から正しい応答" を返す前提で作られているため、
    //  リトライが発生している時点でテストや本番のバグ)
    if (userMsg.includes("バリデーション失敗")) {
      return this.emptyResponse(start);
    }

    const responsesFile = this.loadResponses();
    const scenario = chunkId ? responsesFile[chunkId] : undefined;

    if (!scenario) {
      return this.emptyResponse(start);
    }

    const toolCall: ToolCall = {
      name: scenario.toolName,
      arguments: { patches: scenario.patches },
    };

    return {
      toolCalls: [toolCall],
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: Date.now() - start,
    };
  }

  private loadResponses(): MockResponseFile {
    const path =
      this.responsesPath ??
      join(process.cwd(), "data/sample/mock_responses.json");
    return JSON.parse(readFileSync(path, "utf-8")) as MockResponseFile;
  }

  private emptyResponse(start: number): LLMResponse {
    return {
      toolCalls: [],
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: Date.now() - start,
    };
  }
}

/** ユーザーメッセージから chunkId を抽出 (prompts.ts の "chunkId = \"chunk_001\"" 形式) */
function extractChunkId(userMsg: string): string | null {
  const m = userMsg.match(/chunkId\s*=\s*"([^"]+)"/);
  return m ? m[1]! : null;
}
