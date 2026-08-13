import { LLMClient } from "./types.js";
import { MockClient } from "./MockClient.js";
import { OllamaClient } from "./OllamaClient.js";

/**
 * LLMクライアントのファクトリー。
 * 環境変数 LLM_MODE で切り替え:
 *   - "mock" (デフォルト) → MockClient (課金ゼロ・オフライン)
 *   - "ollama"            → OllamaClient (localhost, 課金ゼロ)
 *
 * ※ 従量課金API (Anthropic/OpenAI等) は 一切実装しない。
 */
export function createLLMClient(): LLMClient {
  const mode = (process.env.LLM_MODE ?? "mock").toLowerCase();

  switch (mode) {
    case "mock":
      return new MockClient();
    case "ollama":
      return new OllamaClient({
        baseUrl: process.env.OLLAMA_BASE_URL,
        model: process.env.OLLAMA_MODEL,
        timeoutMs: process.env.OLLAMA_TIMEOUT_MS
          ? Number(process.env.OLLAMA_TIMEOUT_MS)
          : 300_000, // デフォルトを 5分に (Tool Use 付きで初回は時間かかる)
      });
    default:
      throw new Error(
        `未対応の LLM_MODE: "${mode}" (許可: "mock", "ollama"). ` +
          `従量課金APIは実装しない方針です。`
      );
  }
}

export * from "./types.js";
export * from "./tools.js";
export * from "./prompts.js";
export { MockClient } from "./MockClient.js";
export { OllamaClient } from "./OllamaClient.js";
