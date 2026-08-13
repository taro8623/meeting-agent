import { LLMClient, CallRequest, LLMResponse, ToolCall } from "./types.js";

/**
 * Ollama HTTP API を直接呼び出すクライアント。
 *
 * 前提:
 * - ローカルで Ollama が起動済み (`ollama serve`)
 * - Tool Use対応モデルが pull済み (llama3.1:8b / qwen2.5:7b 推奨)
 *
 * コスト: **常に $0** (完全ローカル・オフライン推論)
 * 外部通信: **ゼロ** (localhost:11434 のみ)
 *
 * SDK/追加ライブラリは使わず、fetch で直接呼ぶ (依存増加を避ける)。
 */

export interface OllamaOptions {
  /** Ollama サーバー URL (デフォルト: http://localhost:11434) */
  baseUrl?: string;
  /** 使用モデル (デフォルト: llama3.1:8b) */
  model?: string;
  /** 応答タイムアウト ms (デフォルト: 120秒) */
  timeoutMs?: number;
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  }>;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  stream: false;
  options?: {
    temperature?: number;
  };
  format?: string | Record<string, unknown>;
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaClient implements LLMClient {
  readonly name: string;
  readonly isFree = true; // ローカル推論のため常に無料

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.model = opts.model ?? "llama3.1:8b";
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.name = `OllamaClient (${this.model}, 課金ゼロ・ローカル)`;
  }

  async call(request: CallRequest): Promise<LLMResponse> {
    const start = Date.now();

    const body: OllamaChatRequest = {
      model: this.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.1,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let json: OllamaChatResponse;
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `Ollama API error (HTTP ${res.status}): ${errText.slice(0, 300)}`
        );
      }
      json = (await res.json()) as OllamaChatResponse;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          `Ollama タイムアウト (${this.timeoutMs}ms 超過)。モデルロードに時間がかかっている可能性。`
        );
      }
      if (e instanceof Error && e.message.includes("ECONNREFUSED")) {
        throw new Error(
          `Ollama に接続できません (${this.baseUrl})。'ollama serve' が起動しているか確認してください。`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const toolCalls: ToolCall[] = (json.message.tool_calls ?? []).map(
      (tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })
    );

    return {
      toolCalls,
      text: json.message.content ?? "",
      usage: {
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
        costUsd: 0, // ローカル推論なので常に $0
      },
      latencyMs: Date.now() - start,
    };
  }
}
