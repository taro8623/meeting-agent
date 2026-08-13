import {
  ProcessModel,
  emptyProcessModel,
  ProcessModel as ProcessModelSchema,
} from "../schema/processModel.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

/**
 * セッションのファイルベース永続化。
 * DBは使わない (SPEC §2「ファイルベース、DBは使わない」)。
 *
 * ディレクトリ構造:
 *   .sessions/
 *     <session_id>/
 *       meta.json           セッションメタ情報
 *       model.json          ProcessModel (常に検証済みの状態を保存)
 *       model.backup.json   書き込み前の直前バックアップ (SPEC §9)
 *       chunks/
 *         chunk_001.txt
 *         chunk_002.txt
 *       logs/
 *         run_<iso>.jsonl   実行トレース
 */

const SESSIONS_ROOT = ".sessions";

export interface SessionMeta {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  processedChunkCount: number;
}

export interface Session {
  meta: SessionMeta;
  model: ProcessModel;
  path: string;
}

export function newSession(title: string): Session {
  const sessionId = generateSessionId();
  const path = join(SESSIONS_ROOT, sessionId);
  mkdirSync(join(path, "chunks"), { recursive: true });
  mkdirSync(join(path, "logs"), { recursive: true });
  mkdirSync(join(path, "outputs"), { recursive: true });

  const model = emptyProcessModel(sessionId, title);
  const meta: SessionMeta = {
    sessionId,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processedChunkCount: 0,
  };

  writeFileSync(join(path, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  writeFileSync(join(path, "model.json"), JSON.stringify(model, null, 2), "utf-8");

  // last_session.txt に最新セッションIDを記録 (--session省略時に使用)
  writeFileSync(join(SESSIONS_ROOT, "last_session.txt"), sessionId, "utf-8");

  return { meta, model, path };
}

export function loadSession(sessionId?: string): Session {
  ensureSessionsRoot();
  const id = sessionId ?? readLastSessionId();
  if (!id) {
    throw new Error(
      "セッションが指定されていません。--session <id> か --new で新規作成してください。"
    );
  }
  const path = join(SESSIONS_ROOT, id);
  if (!existsSync(path)) {
    throw new Error(`セッション "${id}" が見つかりません (${path})`);
  }

  const meta = JSON.parse(
    readFileSync(join(path, "meta.json"), "utf-8")
  ) as SessionMeta;
  const rawModel = JSON.parse(readFileSync(join(path, "model.json"), "utf-8"));
  const modelResult = ProcessModelSchema.safeParse(rawModel);
  if (!modelResult.success) {
    throw new Error(
      `セッション "${id}" の model.json が破損しています: ${modelResult.error.message}`
    );
  }
  return { meta, model: modelResult.data, path };
}

export function saveSession(session: Session, updated: ProcessModel): Session {
  const validated = ProcessModelSchema.parse(updated);
  const modelPath = join(session.path, "model.json");
  const backupPath = join(session.path, "model.backup.json");

  // バックアップ (書き込み前の状態を保持)
  if (existsSync(modelPath)) {
    copyFileSync(modelPath, backupPath);
  }
  writeFileSync(modelPath, JSON.stringify(validated, null, 2), "utf-8");

  // meta更新
  const meta: SessionMeta = {
    ...session.meta,
    updatedAt: new Date().toISOString(),
    processedChunkCount: validated.processedChunkIds.length,
  };
  writeFileSync(
    join(session.path, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );

  writeFileSync(join(SESSIONS_ROOT, "last_session.txt"), meta.sessionId, "utf-8");

  return { meta, model: validated, path: session.path };
}

/** チャンクファイルを セッション内 chunks/ にコピーして 保存する */
export function saveChunk(
  session: Session,
  chunkId: string,
  chunkText: string
): void {
  writeFileSync(join(session.path, "chunks", `${chunkId}.txt`), chunkText, "utf-8");
}

export function appendLog(session: Session, entry: Record<string, unknown>): void {
  const logsDir = join(session.path, "logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0]!;
  const logFile = join(logsDir, `run_${today}.jsonl`);
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  appendFileSync(logFile, line + "\n", "utf-8");
}

/** セッション一覧 */
export function listSessions(): SessionMeta[] {
  ensureSessionsRoot();
  const entries = readdirSync(SESSIONS_ROOT).filter((name) => {
    const p = join(SESSIONS_ROOT, name);
    return statSync(p).isDirectory();
  });
  return entries
    .map((id) => {
      const metaPath = join(SESSIONS_ROOT, id, "meta.json");
      if (!existsSync(metaPath)) return null;
      return JSON.parse(readFileSync(metaPath, "utf-8")) as SessionMeta;
    })
    .filter((m): m is SessionMeta => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function ensureSessionsRoot(): void {
  if (!existsSync(SESSIONS_ROOT)) mkdirSync(SESSIONS_ROOT, { recursive: true });
}

function readLastSessionId(): string | null {
  const p = join(SESSIONS_ROOT, "last_session.txt");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8").trim() || null;
}

function generateSessionId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d+Z$/, "");
  const short = randomUUID().split("-")[0];
  return `sess_${ts}_${short}`;
}
