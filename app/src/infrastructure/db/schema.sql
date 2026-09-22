-- 经济师上岸助手 · 本地数据模型
-- 对齐 PRD §11 与《本地存储技术方案》§4
-- 目标：字段与原生端（Capacitor + 原生 SQLite 插件）保持一致，SQL 可直接复用

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============ 元信息 ============
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 预置：schema_version, device_id, created_at, exam_date, onboarding_done, last_backup_at

-- ============ 知识树 ============
CREATE TABLE IF NOT EXISTS knowledge_node (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL,        -- 'econ_base' | 'hr'
  parent_id   TEXT,
  level       INTEGER NOT NULL,     -- 1 模块 / 2 章 / 3 知识点
  name        TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 0,   -- 预估分值
  exam_freq   INTEGER NOT NULL DEFAULT 0, -- 近5年考查次数
  stars       INTEGER NOT NULL DEFAULT 3,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kn_subject ON knowledge_node(subject_id, parent_id);

-- ============ 题目 ============
-- 内置题（owner_type='official'）与用户自建/AI生成题同表，靠 owner_type 区分
CREATE TABLE IF NOT EXISTS question (
  id                 TEXT PRIMARY KEY,
  subject_id         TEXT NOT NULL,
  type               TEXT NOT NULL,          -- 'single' | 'multi' | 'case'
  stem               TEXT NOT NULL,
  options            TEXT NOT NULL,          -- JSON: [{key,content}]
  answer             TEXT NOT NULL,          -- JSON: ["A","C"]
  difficulty         INTEGER NOT NULL DEFAULT 3,
  bloom_level        TEXT,                   -- remember/understand/apply/analyze
  knowledge_node_ids TEXT NOT NULL,          -- JSON 数组，支持多绑
  explanation        TEXT,                   -- JSON: {keyPoint, perOption[], trapWords[], sourceRef}
  source_level       TEXT NOT NULL,          -- 'S'|'A'|'B'|'C'  ← 可信度是一等公民
  owner_type         TEXT NOT NULL,          -- 'official'|'user'|'ai'
  ai_metadata        TEXT,                   -- JSON: {model,confidence,verified,generatedAt}
  exam_year          INTEGER,
  content_version    TEXT,                   -- '2026'
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_q_subject ON question(subject_id);
CREATE INDEX IF NOT EXISTS idx_q_owner   ON question(owner_type, source_level);
CREATE INDEX IF NOT EXISTS idx_q_status  ON question(status);

-- 用户自建题集（题库）：可命名、分类，支持模考按题集单独组卷
CREATE TABLE IF NOT EXISTS question_set (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,        -- 'upload' | 'ai' | 'manual'
  category    TEXT NOT NULL DEFAULT 'custom',  -- 'custom' | 'past_exam' | 'mock' | 'chapter'
  year        INTEGER,              -- 往年真题年份（category='past_exam'）
  subject_id  TEXT,                 -- 归属科目
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS question_set_item (
  set_id      TEXT NOT NULL,
  question_id TEXT NOT NULL,
  PRIMARY KEY (set_id, question_id)
);

-- ============ 学习状态（FSRS） ============
CREATE TABLE IF NOT EXISTS user_question_state (
  question_id         TEXT PRIMARY KEY,
  fsrs_difficulty     REAL NOT NULL DEFAULT 5.0,  -- D
  fsrs_stability      REAL NOT NULL DEFAULT 0.0,  -- S
  fsrs_retrievability REAL NOT NULL DEFAULT 0.0,  -- R
  due_at              INTEGER NOT NULL,           -- 复习到期时间 ms
  last_review_at      INTEGER,
  review_count        INTEGER NOT NULL DEFAULT 0,
  lapse_count         INTEGER NOT NULL DEFAULT 0,
  conquer_count       INTEGER NOT NULL DEFAULT 0, -- 连续答对，用于移出错题本
  is_wrong            INTEGER NOT NULL DEFAULT 0,
  is_favorited        INTEGER NOT NULL DEFAULT 0,
  note                TEXT
);
-- 今日复习队列的核心索引
CREATE INDEX IF NOT EXISTS idx_uqs_due   ON user_question_state(due_at);
CREATE INDEX IF NOT EXISTS idx_uqs_wrong ON user_question_state(is_wrong);

-- ============ 答题流水 ============
CREATE TABLE IF NOT EXISTS answer_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   TEXT NOT NULL,
  answered_at   INTEGER NOT NULL,
  user_answer   TEXT NOT NULL,       -- JSON 数组
  is_correct    INTEGER NOT NULL,
  confidence    TEXT,                -- sure / unsure / noidea（元认知校准）
  duration_ms   INTEGER NOT NULL,
  mode          TEXT NOT NULL,       -- review/chapter/special/real_exam/wrong/high_freq/ai/exam
  session_id    TEXT,
  error_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_q       ON answer_log(question_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_log_time    ON answer_log(answered_at);
CREATE INDEX IF NOT EXISTS idx_log_session ON answer_log(session_id);

-- ============ 掌握度（冗余表，避免实时聚合） ============
CREATE TABLE IF NOT EXISTS user_knowledge_state (
  node_id           TEXT PRIMARY KEY,
  mastery_score     REAL NOT NULL DEFAULT 0,
  level             TEXT NOT NULL DEFAULT 'unlearned',
  question_count    INTEGER NOT NULL DEFAULT 0,
  correct_count     INTEGER NOT NULL DEFAULT 0,
  last_practice_at  INTEGER,
  predict_forget_at INTEGER
);

-- ============ 学习计划 ============
CREATE TABLE IF NOT EXISTS study_plan (
  id            TEXT PRIMARY KEY,
  subject_ids   TEXT NOT NULL,       -- JSON 数组
  target_score  INTEGER NOT NULL DEFAULT 100,
  daily_minutes INTEGER NOT NULL DEFAULT 60,
  start_date    TEXT NOT NULL,
  exam_date     TEXT NOT NULL,
  stage         TEXT NOT NULL DEFAULT 'P1',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_task_pack (
  date          TEXT NOT NULL,       -- YYYY-MM-DD
  pack_id       TEXT NOT NULL,
  pack_type     TEXT NOT NULL,       -- review/new/wrong/test/exam
  title         TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  completed     INTEGER NOT NULL DEFAULT 0,
  target_ref    TEXT,
  PRIMARY KEY (date, pack_id)
);

-- ============ 模考 ============
CREATE TABLE IF NOT EXISTS exam_record (
  id             TEXT PRIMARY KEY,
  subject_id     TEXT NOT NULL,
  mode           TEXT NOT NULL,        -- strict | loose
  started_at     INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  score          REAL NOT NULL,
  passed         INTEGER NOT NULL,
  type_scores    TEXT NOT NULL,        -- JSON
  module_scores  TEXT NOT NULL,        -- JSON
  unanswered     INTEGER NOT NULL DEFAULT 0,
  marked         INTEGER NOT NULL DEFAULT 0
);

-- ============ 备份 ============
CREATE TABLE IF NOT EXISTS backup_snapshot (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,     -- auto_daily / auto_weekly / manual / pre_migration
  created_at INTEGER NOT NULL,
  file_path  TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  stats      TEXT NOT NULL,     -- JSON：展示在"时间机器"
  payload    TEXT               -- 快照正文（JSON），用于本地回滚
);
CREATE INDEX IF NOT EXISTS idx_snap_time ON backup_snapshot(created_at);

CREATE TABLE IF NOT EXISTS attachment (
  id         TEXT PRIMARY KEY,
  set_id     TEXT,
  file_name  TEXT NOT NULL,
  rel_path   TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ============ AI 响应缓存 ============
-- cache_key 含 prompt_version，prompt 迭代后自动失效，避免读到旧缓存
CREATE TABLE IF NOT EXISTS ai_response_cache (
  cache_key  TEXT PRIMARY KEY,
  ability    TEXT NOT NULL,   -- explain / generate / mnemonic
  content    TEXT NOT NULL,
  model      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ============ 版本 ============
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1');
