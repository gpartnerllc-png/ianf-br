-- IANF v2 - Schema inicial do banco D1
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    pass_hash   TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    doc         TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator')),
    status      TEXT NOT NULL DEFAULT 'pending'   CHECK (status IN ('pending','active','blocked')),
    last_login  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS empresas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cnpj          TEXT NOT NULL,
    razao_social  TEXT,
    nome_fantasia TEXT,
    regime        TEXT NOT NULL DEFAULT 'mei' CHECK (regime IN ('mei','simples','padrao','personalizado')),
    cbs_rate      REAL,
    ibs_rate      REAL,
    email         TEXT,
    phone         TEXT,
    situacao      TEXT,
    cnae          TEXT,
    uf            TEXT,
    municipio     TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_empresas_user ON empresas(user_id);
CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON empresas(cnpj);

CREATE TABLE IF NOT EXISTS lancamentos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('receita','despesa','investimento')),
    slot        TEXT NOT NULL DEFAULT 'outros',
    valor       REAL NOT NULL,
    descricao   TEXT,
    doc_cliente TEXT,
    nome_cliente TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lanc_user ON lancamentos(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lanc_tipo ON lancamentos(tipo);

CREATE TABLE IF NOT EXISTS notas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo          TEXT NOT NULL DEFAULT 'nfse' CHECK (tipo IN ('nfe','nfce','nfse','entrada')),
    numero        INTEGER,
    serie         TEXT,
    chave         TEXT,
    valor         REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'rascunho',
    provider      TEXT DEFAULT 'ianf',
    provider_id   TEXT,
    cliente_doc   TEXT,
    cliente_nome  TEXT,
    xml           TEXT,
    pdf_url       TEXT,
    extra         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notas_user ON notas(user_id, created_at);

CREATE TABLE IF NOT EXISTS produtos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    codigo      TEXT,
    descricao   TEXT NOT NULL,
    preco       REAL NOT NULL DEFAULT 0,
    ncm         TEXT,
    cest        TEXT,
    cfop        TEXT,
    unidade     TEXT DEFAULT 'UN',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prod_user ON produtos(user_id);

CREATE TABLE IF NOT EXISTS auditoria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    email       TEXT,
    acao        TEXT NOT NULL,
    detalhe     TEXT,
    ip          TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON auditoria(created_at);

CREATE TABLE IF NOT EXISTS integracoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    config      TEXT,
    ativo       INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(user_id, provider)
);
