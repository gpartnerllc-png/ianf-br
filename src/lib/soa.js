// SOA Web Services v2 - distribuidor oficial dos dados Serasa Experian (producao.soawebservices.com.br)
// Docs: https://homologacao.soawebservices.com.br/api-reference/ + https://www.soawebservices.com.br/migracao-api-v2
// Auth: corpo da requisição com credenciais { email, senha } (secrets SOA_EMAIL / SOA_SENHA) - não há header de token
// Convenção de resposta: objeto do relatório + transacao { status, codigoStatus, codigoStatusDescricao }
const PRODUCAO = 'https://producao.soawebservices.com.br';
const HOMOLOGACAO = 'https://homologacao.soawebservices.com.br';

export const SOA_OPS = {
  'saldo': { sub: '/api/v2/Administracao/Saldo', tipo: 'admin' },
  'extrato-sintetico': { sub: '/api/v2/Administracao/ExtratoSintetico', tipo: 'admin' },
  'extrato-analitico': { sub: '/api/v2/Administracao/ExtratoAnalitico', tipo: 'admin' },
  'recarga-pix': { sub: '/api/v2/Administracao/Recarga/Pix', tipo: 'admin', mutacao: true },
  'basica-pf': { sub: '/api/v2/Serasa/Consultas/Basica/PessoaFisica', tipo: 'serasa', custo: 5.4, doc: 11 },
  'basica-pj': { sub: '/api/v2/Serasa/Consultas/Basica/PessoaJuridica', tipo: 'serasa', custo: 5.4, doc: 14 },
  'crednet-pf': { sub: '/api/v2/Serasa/Consultas/CredNet', tipo: 'serasa', custo: 16.06, doc: 11 },
  'crednet-pj': { sub: '/api/v2/Serasa/Consultas/CredNet', tipo: 'serasa', custo: 16.06, doc: 14 },
  'concentre-pf': { sub: '/api/v2/Serasa/Consultas/Concentre', tipo: 'serasa', custo: 33.87, doc: 11 },
  'concentre-pj': { sub: '/api/v2/Serasa/Consultas/Concentre', tipo: 'serasa', custo: 33.87, doc: 14 },
  'recomenda-pf': { sub: '/api/v2/Serasa/Consultas/Recomenda/PessoaFisica', tipo: 'serasa', custo: 24, doc: 11 },
  'recomenda-pj': { sub: '/api/v2/Serasa/Consultas/Recomenda/PessoaJuridica', tipo: 'serasa', custo: 24, doc: 14 },
  'cdc-pf-basica': { sub: '/api/v2/CDC/PessoaFisicaBasica', tipo: 'serasa', doc: 11 },
  'cdc-pf-nfe': { sub: '/api/v2/CDC/PessoaFisicaNFe', tipo: 'serasa', doc: 11 },
  'cdc-pj-basica': { sub: '/api/v2/CDC/PessoaJuridicaBasica', tipo: 'serasa', doc: 14 },
  'cdc-pj-qsa': { sub: '/api/v2/CDC/PessoaJuridicaQSA', tipo: 'serasa', doc: 14 },
  'cdc-pj-simples': { sub: '/api/v2/CDC/PessoaJuridicaSimplesNacional', tipo: 'serasa', doc: 14 },
  'negativacao-tipos': { sub: '/api/v2/Serasa/Negativacoes/TiposRestricoes', tipo: 'negativacao' },
  'negativacao-baixas': { sub: '/api/v2/Serasa/Negativacoes/CodigosBaixa', tipo: 'negativacao' },
  'negativacao-consultar': { sub: '/api/v2/Serasa/Negativacoes/Consultar', tipo: 'negativacao' },
  'negativacao-lista': { sub: '/api/v2/Serasa/Negativacoes/Lista', tipo: 'negativacao' },
  'negativacao-inserir': { sub: '/api/v2/Serasa/Negativacoes/Inserir', tipo: 'negativacao', mutacao: true },
  'negativacao-excluir': { sub: '/api/v2/Serasa/Negativacoes/Excluir', tipo: 'negativacao', mutacao: true },
};

export function soaEnabled(env) {
  return Boolean(env.SOA_EMAIL && env.SOA_SENHA);
}

export function soaAmbiente(env) {
  return env.SOA_AMBIENTE === 'homolog' ? 'homolog' : 'prod';
}

export function soaBase(env) {
  const padrao = soaAmbiente(env) === 'homolog' ? HOMOLOGACAO : PRODUCAO;
  return (env.SOA_BASE_URL || padrao).replace(/\/+$/, '');
}

const NOME_AMBIENTE = { prod: 'oficial', homolog: 'homologação' };

// O provedor responde em PascalCase (.NET) embora o contrato OpenAPI descreva camelCase:
// uniformizamos as chaves para camelCase antes de normalizar qualquer relatório.
export function camelKeys(v) {
  if (Array.isArray(v)) return v.map(camelKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k.charAt(0).toLowerCase() + k.slice(1)] = camelKeys(x);
    return out;
  }
  return v;
}

function credenciais(env) {
  return { email: String(env.SOA_EMAIL), senha: String(env.SOA_SENHA) };
}

function semSaldo(texto) {
  return /saldo.{0,20}(insuficiente|esgotado|indispon|zerad)|cr[eé]dito.{0,15}(esgotado|insuficiente)/i.test(String(texto || ''));
}

// Chama um endpoint SOA v2. payload já vem sanitizado pela rota; credenciais são injetadas aqui.
export async function soaRequest(env, op, payload = {}) {
  const cfg = SOA_OPS[op];
  if (!cfg) return { ok: false, code: 'SOA_OPER_INVALIDO', message: 'Operação SOA desconhecida.' };
  if (!soaEnabled(env)) {
    return { ok: false, code: 'SOA_NAO_CONFIGURADO', message: 'Defina os secrets SOA_EMAIL e SOA_SENHA da conta SOA Web Services.' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let res;
    try {
      res = await fetch(soaBase(env) + cfg.sub, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ credenciais: credenciais(env), ...payload }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const data = camelKeys(await res.json().catch(() => null));
    const trans = (data && data.transacao)
      || (data && typeof data.status === 'boolean' ? { status: data.status, codigoStatus: data.codigoStatus, codigoStatusDescricao: data.codigoStatusDescricao } : {});
    const descricao = trans.codigoStatusDescricao || data?.mensagem || data?.message || '';
    if (res.status === 401 || res.status === 403 || /credenciais.{0,80}(invalid|incorret)/is.test(descricao)) {
      return { ok: false, code: 'SOA_AUTH', status: res.status, message: 'Credenciais recusadas pelo provedor (email/senha inválidos ou produto não contratado na conta).', ambiente: NOME_AMBIENTE[soaAmbiente(env)] };
    }
    if (trans.status === false) {
      return {
        ok: false,
        code: semSaldo(descricao) ? 'SALDO_INSUFICIENTE'
          : /requisicao json/i.test(descricao) ? 'SOA_REQUISICAO_INVALIDA' : 'SOA_REJEITADO',
        status: res.status,
        codigoStatus: trans.codigoStatus || null,
        message: descricao || 'A consulta foi rejeitada pelo provedor.',
        dados: data,
        ambiente: NOME_AMBIENTE[soaAmbiente(env)],
      };
    }
    if (!res.ok) {
      return { ok: false, code: 'SOA_ERRO', status: res.status, message: `O provedor respondeu ${res.status}.`, dados: data, ambiente: NOME_AMBIENTE[soaAmbiente(env)] };
    }
    return { ok: true, data: data || {}, ambiente: NOME_AMBIENTE[soaAmbiente(env)], custo: cfg.custo || null };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, code: 'SOA_TIMEOUT', message: 'Tempo esgotado aguardando o provedor de risco.' };
    return { ok: false, code: 'SOA_FALHA', message: e.message };
  }
}

// ============ NORMALIZAÇÃO PARA A INTERFACE ============

function dataBr(v) {
  const s = String(v || '');
  if (/^0001-01-01/.test(s)) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s.slice(0, 10);
}

function lista(arr) {
  return Array.isArray(arr) ? arr : [];
}

// Os itens de negativa trazem datas ISO espalhadas; o sentinela .NET 0001-01-01 não pode aparecer na tela
function limparDatas(item) {
  if (!item || typeof item !== 'object') return item;
  const saida = {};
  for (const [k, v] of Object.entries(item)) {
    saida[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dataBr(v) : v;
  }
  return saida;
}

export function normalizarSerasa(r = {}) {
  const sintese = r.sinteseCadastral || {};
  const pf = sintese.pessoaFisica || null;
  const pj = sintese.pessoaJuridica || null;
  const neg = r.dadosNegativos || {};
  const info = r.informacoesAdicionais || {};
  const outras = r.outrasInformacoes || {};
  const score = info.score || null;
  const resumoDe = (bloco) => (bloco && bloco.resumo) || {};

  const linhas = {};
  const nomes = {
    pendenciasFinanceiras: 'Pendências financeiras',
    restricoesFinanceiras: 'Restrições financeiras',
    cartorios: 'Protestos em cartório',
    cheques: 'Cheques sem fundos',
    cobrancas: 'Cobranças',
    falencia: 'Falências e recuperação',
    acoesJudiciais: 'Ações judiciais',
  };
  for (const [chave, rotulo] of Object.entries(nomes)) {
    const bloco = neg[chave] || {};
    const itens = lista(bloco.detalhes || bloco.protestos || bloco.detalheCheques || bloco.detalheCobrancas || bloco.acoes || bloco.falencias);
    linhas[rotulo] = { total: resumoDe(bloco).totalOcorrencias ?? itens.length, valor: resumoDe(bloco).valorTotal ?? null, itens: itens.map(limparDatas) };
  }

  const pessoa = pj || pf;
  return {
    documento: pessoa?.documento || '',
    nome: pessoa?.nome || '',
    tipo: pj ? 'PJ' : 'PF',
    fantasia: pj ? '' : (pf?.nomeRelativo || ''),
    genero: pf?.genero || '',
    nascimento: dataBr(pf?.dataNascimento),
    fundacao: dataBr(pj?.dataFundacao),
    situacaoRfb: pessoa?.situacaoRFB || '',
    situacaoDescricao: pessoa?.descricaoSituacaoRFB || '',
    situacaoData: dataBr(pessoa?.dataSituacaoRFB),
    restricoes: r.restricoes === true,
    score: score ? {
      pontuacao: score.pontuacao ?? null,
      modelo: score.modelo || '',
      faixa: score.faixa || '',
      probabilidadeInadimplencia: score.probabilidadeInadimplencia ?? null,
      mensagem: score.mensagem || '',
    } : null,
    limiteCredito: info.limiteCredito ? {
      valor: info.limiteCredito.valor ?? null,
      tipoRecomendacao: info.limiteCredito.tipoRecomendacao || '',
      tipoRecomendacaoValor: info.limiteCredito.tipoRecomendacaoValor ?? null,
      nivelRisco: info.limiteCredito.nivelRiscoCodigo ?? null,
      criterios: info.limiteCredito.criteriosAnalisados || null,
    } : null,
    negativos: {
      total: neg.resumo?.totalOcorrencias ?? Object.values(linhas).reduce((a, b) => a + (Number(b.total) || 0), 0),
      valor: neg.resumo?.valorTotal ?? null,
      mensagem: neg.resumo?.mensagem || '',
    },
    frentes: linhas,
    documentosRoubados: lista((outras.documentosRoubados || {}).ocorrencias).map(limparDatas),
    registroConsultas: {
      total: (outras.registroConsultas?.resumoRegistroConsultas || {}).total ?? lista(outras.registroConsultas?.detalhes).length,
      detalhes: lista(outras.registroConsultas?.detalhes).map(limparDatas),
    },
    transacao: r.transacao || null,
  };
}

// Cadastros (CDC): retorno enxuto, usado para prova cadastral do documento
export function normalizarCdc(r = {}) {
  const resumo = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'transacao' || v === null || typeof v === 'object') continue;
    resumo[k] = v;
  }
  const qsa = r.qsa && (Array.isArray(r.qsa.socios) ? r.qsa.socios : Array.isArray(r.qsa) ? r.qsa : []);
  return { ...resumo, socios: qsa.slice(0, 40), nasc: dataBr(r.dataNascimento || r.nascimento) };
}

export function normalizarSaldo(r = {}) {
  return { saldo: r.saldo ?? null, transacao: r.transacao || null };
}

export function normalizarExtrato(r = {}) {
  return {
    quantidade: r.consumoQuantidadeTotal ?? lista(r.detalhes).length,
    valor: r.consumoValorTotal ?? null,
    detalhes: lista(r.detalhes).map((d) => ({
      produto: d.produto || '',
      quantidade: d.consumoQuantidade ?? (d.uniqueID ? 1 : null),
      valor: d.consumoValor ?? d.valor ?? null,
      documento: d.documento || '',
      dataHora: d.dataHora || '',
    })),
  };
}

// Relatório "Recomenda": formato plano, com score, limite recomendado e datas de ocorrências
export function normalizarRecomenda(r = {}) {
  const id = r.identificacao || {};
  const anot = r.anotacoesNegativas || {};
  const consultas = r.consultasDetalhadasSerasa || {};
  const negativo = (v) => v === true || (typeof v === 'number' && v > 0);
  return {
    documento: r.documento || id.documento || '',
    nome: r.nome || id.grafia || '',
    nomeMae: id.nomeMae || '',
    nascimento: dataBr(id.dataNascimento),
    genero: id.genero || '',
    situacaoCpf: id.situacaoCPF || id.situacaoCpf || id.situacaoCadastral || '',
    fundacao: dataBr(id.dataFundacao),
    score: r.score ? { pontuacao: r.score.serasaScore ?? null, taxa: r.score.taxa ?? null } : null,
    mensagemScore: r.mensagemScore || '',
    faixaRenda: r.faixaRendaEstimada ?? null,
    mensagemRenda: r.mensagemRendaEstimada || '',
    limiteRecomendado: r.valorLimiteRecomendado ?? null,
    tipoRecomendacao: r.tipoRecomendacao || '',
    tipoRecomendacaoVenda: r.tipoRecomendacaoVenda || '',
    nivelRisco: r.nivelRisco ?? null,
    orientacaoVenda: r.orientacaoVenda ?? null,
    numeroProposta: r.numeroProposta || '',
    temNegativas: negativo(r.anotacoesNegativas) || Object.values(anot).some(negativo),
    datasNegativas: {
      dividasVencidas: dataBr(anot.dataUltimaOcorrenciaDividasVencidas || anot.dataUltimaOcorrenciaDividaVencida),
      protestos: dataBr(anot.dataUltimaOcorrenciaProtesto),
      pefin: dataBr(anot.dataUltimaOcorrenciaPefin),
      refin: dataBr(anot.dataUltimaOcorrenciaRefin),
      primeiraDividasVencidas: dataBr(anot.dataPrimeiraOcorrenciaDividasVencidas),
      valorTotalDividasVencidas: anot.valorTotalDividasVencidas ?? anot.valorTotalDividaVencida ?? null,
      valorTotalPefin: anot.valorTotalPefin ?? null,
      valorTotalRefin: anot.valorTotalRefin ?? null,
      valorTotalProtesto: anot.valorTotalProtesto ?? null,
    },
    consultas: {
      total: consultas.totalConsultas ?? (consultas.totalizadorConsultasSerasa || {}).totalConsultas ?? null,
      m3: consultas.m3Consultas ?? null,
      m6: consultas.m6Consultas ?? null,
      empresa6m: consultas.totalConsultasEmpresa6M ?? (consultas.totalizadorConsultasSerasa || {}).quantidadePorEmpresa ?? null,
      financeira6m: consultas.totalConsultasFinanceira6M ?? (consultas.totalizadorConsultasSerasa || {}).quantidadePorFinaceira ?? null,
      detalhes: lista(consultas.consultasSerasa).slice(0, 20).map(limparDatas),
    },
    criterios: r.criteriosAnalisados || null,
    participacoes: lista(r.participacoesSocietaria),
    criacao: dataBr(r.criacao),
    valorOperacao: r.valorOperacao ?? null,
    transacao: r.transacao || null,
  };
}
