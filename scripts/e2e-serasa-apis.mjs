// Prova de ponta a ponta da rota /api/integracao/serasa-apis (worker em execução, ambiente de demonstração).
// Uso: BASE=http://127.0.0.1:8788 TOKEN=<sessão> node scripts/e2e-serasa-apis.mjs
const base = process.env.BASE || 'http://127.0.0.1:8788';
const token = process.env.TOKEN;
if (!token) {
  console.error('defina TOKEN com a sessão obtida em /api/auth/login');
  process.exit(1);
}

const corpos = {
  'relatorio-pf': { document: '12345678909', reportName: 'RELATORIO_AVANCADO_PF' },
  'relatorio-pj': { document: '12345678000195', reportName: 'RELATORIO_AGRUPE_PJ' },
  'recomenda-pf': { document: '12345678909', valorOperacao: '1500' },
  'recomenda-pj': { document: '12345678000195', valorOperacao: '20000' },
  'recomenda-pf-lista': {},
  'recomenda-proposta': { numeroProposta: '123456' },
  'recomenda-relatorios': { document: '12345678000195' },
  'verify-lote': { pessoas: [{ document: '12345678909', name: 'MARIA DA SILVA' }] },
  'verify-pep': { document: '12345678909' },
  'mdcf-alertas': { document: '12345678909' },
  'mdcf-relatorio': { document: '12345678909' },
  'self-assinaturas': {},
  'sdsn-assinaturas': {},
  'sdsn-por-doc': { document: '56323323999287' },
  'infomais-pf': { document: '12345678909' },
  'infomais-pj': { document: '12345678000195' },
};

async function chamar(acao, corpo) {
  const res = await fetch(`${base}/api/integracao/serasa-apis?acao=${encodeURIComponent(acao)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ambiente: 'demo', ...corpo }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const catalogo = await chamar('catalogo', {});
const servicos = catalogo.json?.servicos || [];
console.log(`catálogo via HTTP: ${servicos.length} serviços · ambientes ${(catalogo.json?.ambientes || []).map((a) => a.v).join(',')}`);

let okCount = 0; let comDados = 0; let vazio = 0; let falhas = 0;
const apenasProvas = process.argv[2] === 'probe';
for (const [acao, corpo] of Object.entries(apenasProvas ? {} : corpos)) {
  const svc = servicos.find((s) => s.acao === acao);
  const enviar = svc?.mutacao ? { ...corpo, confirmar: true } : corpo;
  const r = await chamar(acao, enviar);
  const j = r.json || {};
  if (!j.ok) {
    falhas++;
    console.log(`✗ ${acao} → HTTP ${r.status} ${j.error?.code || j.code || ''} :: ${String(j.error?.message || j.message || '').slice(0, 120)}`);
    continue;
  }
  okCount++;
  const bruto = JSON.stringify(j.detalhes ?? j.resumo ?? null);
  const temDados = bruto && bruto !== 'null' && bruto !== '{}' && bruto !== '[]';
  if (temDados) comDados++; else vazio++;
  console.log(`${temDados ? '✓' : '·'} ${acao} → ${j.ambiente} ${(j.fonte || '').slice(0, 34)} ${bruto.length}B :: ${String(j.resumo?.titulo || j.resumo?.documento || '').slice(0, 60)}`);
}

const gate = await chamar('recomenda-pf', { document: '12345678909' });
console.log(`\ncancela sem confirmar: HTTP ${gate.status} ${gate.json?.error?.code || gate.json?.code}`);
const invalido = await chamar('relatorio-pf', { document: '123', reportName: 'RELATORIO_AVANCADO_PF' });
console.log(`documento inválido: HTTP ${invalido.status} ${invalido.json?.error?.code || invalido.json?.code}`);
console.log(`\nresumo: ${okCount} ok (${comDados} com dados · ${vazio} vazio) · ${falhas} falha`);
