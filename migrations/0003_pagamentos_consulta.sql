-- IANF - Cobranças PIX de consultas pagas por consumo (APIBrasil/DirectData via InfinitePay)
CREATE TABLE IF NOT EXISTS pagamentos_consulta (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL DEFAULT 'apibrasil',
    consulta         TEXT NOT NULL,
    parametros       TEXT NOT NULL DEFAULT '{}',
    valor_cents      INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','expirado')),
    checkout_url     TEXT,
    order_nsu        TEXT,
    transaction_nsu  TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    paid_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_pgc_order ON pagamentos_consulta(order_nsu);
CREATE INDEX IF NOT EXISTS idx_pgc_user ON pagamentos_consulta(user_id);
