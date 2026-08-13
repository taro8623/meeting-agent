import { readFileSync } from "fs";
import { basename, extname } from "path";

/**
 * FileSource — テキストファイルを1チャンクとして読む。
 *
 * SPEC縮小版に従い「シンプル分割のみ」。高度なチャンク重複処理は将来拡張。
 * 音声ファイルは削減仕様のため 実装しない (エラーで通知)。
 */

export interface LoadedChunk {
  /** chunk_001, chunk_002 のような ID */
  id: string;
  text: string;
  /** 元ファイルパス */
  sourcePath: string;
}

export interface LoadOptions {
  /** セッション内で 次に使う chunkId 番号 (例: 既存2チャンクなら 3を指定) */
  nextIndex: number;
}

export function loadTextFile(path: string, opts: LoadOptions): LoadedChunk {
  const ext = extname(path).toLowerCase();
  if (ext !== ".txt" && ext !== ".md") {
    if (ext === ".m4a" || ext === ".mp3" || ext === ".wav") {
      throw new Error(
        `音声ファイルは MVP 対象外です (削減仕様)。テキスト文字起こしに変換してから --append してください。`
      );
    }
    throw new Error(
      `対応形式は .txt / .md のみです (受信: ${ext} / ${basename(path)})`
    );
  }

  const text = readFileSync(path, "utf-8");
  if (text.trim().length === 0) {
    throw new Error(`ファイルが空です: ${path}`);
  }

  const id = formatChunkId(opts.nextIndex);
  return { id, text, sourcePath: path };
}

export function formatChunkId(n: number): string {
  return `chunk_${String(n).padStart(3, "0")}`;
}
