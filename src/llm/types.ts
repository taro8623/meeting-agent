/**
 * LLM抽象化層 — SPEC §2「モデル変更時の影響範囲を局所化」の要求を満たす。
 * ビジネスロジックはこの interface だけを知る。
 * 具体実装 (Mock / Ollama) はここに閉じ込める。
 */

/** LLMが Tool Use として呼び出したツール */
export interface ToolCall {
  name: string;
  /** LLMが返した引数 (JSON.parse済み) */
  arguments: unknown;
}

/** LLM呼び出し結果 */
export interface LLMResponse {
  toolCalls: ToolCall[];
  /** 文章の返答があれば (Tool Useのみ返す場合は空文字) */
  text: string;
  /** 課金なしのMock/Ollamaは 0 を返す */
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** 常に 0.00 (Ollama/Mockは無料) */
    costUsd: number;
  };
  /** デバッグ用: 何秒かかったか */
  latencyMs: number;
}

/** LLMに渡すツール定義 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema */
  inputSchema: Record<string, unknown>;
}

/** LLM会話メッセージ (Ollama互換の最小形) */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** role=tool の場合、対応する tool_call_id */
  toolCallId?: string;
}

/** LLM呼び出しリクエスト */
export interface CallRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** 決定論的に近づけたい場合は 0 に近く */
  temperature?: number;
}

/**
 * LLMクライアント抽象化。
 * Mock/Ollama/(将来: 他モデル) が実装する。
 */
export interface LLMClient {
  /** 表示名 (ログ・CLI用) */
  readonly name: string;
  /** 課金なし = true (Mock/Ollama とも true) */
  readonly isFree: boolean;

  call(request: CallRequest): Promise<LLMResponse>;
}
