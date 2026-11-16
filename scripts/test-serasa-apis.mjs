// Teste rápido da lib serasaapis contra o ambiente de demonstração (mock público do sandbox).
import { chamarSerasaApi, catalogoSerasaApis } from '../src/lib/serasaapis.js';

const env = { KV: { get: async () => null, put: async () => {}, delete: async () => {} } };

const corpos = {
  'relatorio-pf': { document: '12345678909', reportName: 'RELATORIO_AVANCADO_PF' },
  'relatorio-pj': { document: '12345678000195', reportName: 'RELATORIO_AGRUPE_PJ' },
  'recomenda-pf': { document: '12345678909', valorOperacao: '1500', confirmar: true },
  'recomenda-pj': { document: '12345678000195', valorOperacao: '20000', confirmar: true },
  'recomenda-proposta': { numeroProposta: '123456' },
  'recomenda-relatorios': { document: '12345678000195' },
  'verify-lote': { pessoas: [{ document: '12345678909', name: 'MARIA DA SILVA' }] },
  'mdcf-relatorio': { document: '12345678909' },
  'sdsn-por-doc': { document: '56323323999287' },
  'infomais-pf': { document: '12345678909' },
  'infomais-pj': { document: '12345678000195' },
};

const soPedido = process.argv[2];
const catalogo = catalogoSerasaApis();
console.log(`catálogo: ${catalogo.length} serviços\n`);
let comDados = 0; let vazio = 0; let falhas = 0;
for (const s of catalogo) {
  if (soPedido && s.acao !== soPedido) continue;
  const r = await chamarSerasaApi(env, s.acao, corpos[s.acao] || {}, 'demo');
  if (!r.ok) {
    falhas++;
    console.log(`✗ ${s.acao} → ${r.code} :: ${r.message}`);
    continue;
  }
  const bruto = JSON.stringify(r.data);
  if (bruto && bruto !== '{}' && bruto !== '[]') comDados++; else vazio++;
  console.log(`${bruto.length > 4 ? '✓' : '·'} ${s.acao} → ${r.ambiente} ${r.amb} ${bruto.length} bytes :: ${bruto.slice(0, 110).replace(/\s+/g, ' ')}`);
}
console.log(`\nresumo: ${comDados} com dados · ${vazio} vazio · ${falhas} falha`);
