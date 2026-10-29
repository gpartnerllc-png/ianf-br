-- IANF v2 - Assinaturas (franquia mensal R$ 289,80 via InfinitePay Checkout)
ALTER TABLE users ADD COLUMN whatsapp TEXT;

CREATE TABLE IF NOT EXISTS assinaturas (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plano            TEXT NOT NULL DEFAULT 'franquia_mensal',
    valor_cents      INTEGER NOT NULL DEFAULT 28980,
    status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','ativo','atrasado','cancelado')),
    checkout_url     TEXT,
    order_nsu        TEXT,
    data_inicio      TEXT,
    data_vencimento  TEXT,
    ultimo_pagamento TEXT,
    lembretes        TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ass_user ON assinaturas(user_id);
CREATE INDEX IF NOT EXISTS idx_ass_status ON assinaturas(status);
CREATE INDEX IF NOT EXISTS idx_ass_order ON assinaturas(order_nsu);
