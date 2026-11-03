import { json, ok, err, readBody, audit, getIp, onlyNumbers, isValidCnpj, isValidCpf, rateLimit } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { consultarCnpj, consultarCep, consultarCpfReceita } from '../lib/brasilapi.js';
import { spedy, spedyEnabled, montarOrderPayload, montarNfsePayload } from '../lib/spedy.js';
import { zapsign, zapsignEnabled, montarProtocoloEcpf, montarProtocoloEcnpj } from '../lib/zapsign.js';
import { serpro, serproEnabled } from '../lib/serpro.js';
import { serasaEnabled, verificarPessoa, verificarEmpresa, normalizarVerificacao } from '../lib/serasa.js';
import { apibrasilEnabled, saldo as apibrasilSaldo, consultarCnpj as apibrasilConsultarCnpj } from '../lib/apibrasil.js';
import { directdataEnabled, consultar as directdataConsultar, validarEndpoint } from '../lib/directdata.js';
import { infinitepayEnabled, criarLinkCheckout, consultarPagamento } from '../lib/infinitepay.js';
import { calcularFiscal } from '../lib/fiscal.js';

export async function handleStatus(env) {
  const integracoes = [
    { nome: 'Cloudflare D1', status: 'online', detalhe: 'Banco de dados ativo' },
    { nome: 'Cloudflare KV', status: 'online', detalhe: 'Sessões e cache ativos' },
    { nome: 'Workers AI', status: 'online', detalhe: 'IA disponível' },
    { nome: 'BrasilAPI (Receita/Redesim)', status: 'online', detalhe: 'Consultas CNPJ/CPF/CEP' },
    { nome: 'Spedy (NF-e/NFS-e)', status: spedyEnabled(env) ? 'online' : 'pendente', detalhe: spedyEnabled(env) ? 'Chave configurada' : 'Defina SPEDY_API_KEY' },
    { nome: 'ZapSign Certificados', status: zapsignEnabled(env) ? 'online' : 'pendente', detalhe: zapsignEnabled(env) ? 'Chave configurada' : 'Defina ZAPSIGN_API_KEY' },
    { nome: 'Serpro PIN/IA', status: serproEnabled(env) ? 'online' : 'pendente', detalhe: serproEnabled(env) ? 'Credenciais configuradas' : 'Assinatura em loja.serpro.gov.br' },
    { nome: 'Serasa Experian (Verify PF/PJ)', status: serasaEnabled(env) ? 'online' : 'pendente', detalhe: serasaEnabled(env) ? 'Token configurado' : 'Defina SERASA_TOKEN' },
    { nome: 'APIBrasil (Dados CNPJ)', status: apibrasilEnabled(env) ? 'online' : 'pendente', detalhe: apibrasilEnabled(env) ? 'Token configurado' : 'Defina APIBRASIL_TOKEN' },
    { nome: 'DirectData (Big Data)', status: directdataEnabled(env) ? 'online' : 'pendente', detalhe: directdataEnabled(env) ? 'Token configurado' : 'Defina DIRECTDATA_TOKEN' },
    { nome: 'PGFN Dívida Ativa (Regularize)', status: serproEnabled(env) ? 'online' : 'pendente', detalhe: serproEnabled(env) ? 'API Serpro configurada' : 'API em loja.serpro.gov.br/consulta-divida-ativa · portal Regularize disponível' },
    { nome: 'AWS Lambda Sync (Vendas)', status: 'online', detalhe: 'FINALIZAR_VENDA enviado automaticamente ao núcleo legado' },
  ];
  return ok({
    integracoes,
    app: env.APP_NAME,
    versao: env.APP_VERSION,
    pagamento: {
      url: env.PAYMENT_URL || null,
      posPackage: env.PAYMENT_POS_PACKAGE || 'com.infinitepay.checkout',
      posScheme: env.PAYMENT_POS_SCHEME || 'infinitepay',
    },
  });
}

export async function handleCnpj(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const cnpj = onlyNumbers(url.searchParams.get('cnpj') || '');
  if (!isValidCnpj(cnpj)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
  if (!(await rateLimit(env, getIp(request), 'cnpj'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');

  // Fonte principal: Serpro (oficial, com fallback automático p/ demonstração). Fallback: BrasilAPI (gratuita).
  let resultado;
  if (serproEnabled(env)) {
    const r = await serpro.consultarCnpj(env, cnpj);
    if (r.ok && r.data) {
      const s = normalizarCnpjSerpro(r.data);
      resultado = {
        ok: true,
        data: {
          cnpj: s.cnpj,
          razao_social: s.razao_social,
          nome_fantasia: s.nome_fantasia,
          situacao_cadastral: s.situacao_cadastral,
          cnae_codigo: s.cnae_principal.split(' - ')[0] || '',
          cnae_principal: s.cnae_principal,
          uf: s.uf,
          municipio: s.municipio,
          logradouro: s.endereco,
          numero: '',
          bairro: s.bairro,
          cep: s.cep,
          telefone: s.telefones[0] || '',
          email: s.email,
          porte: s.porte,
          capital_social: s.capital_social || 0,
          socios: s.socios,
        },
        fonte: s.fonte || `Serpro (${r.ambiente === 'demo' ? 'demonstração' : 'Receita Federal'})`,
      };
    }
  }
  if (!resultado || !resultado.ok) {
    resultado = await consultarCnpj(env, cnpj);
  }
  if (!resultado.ok) return json(resultado, 404);
  await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'CONSULTA_CNPJ', detalhe: cnpj, ip: getIp(request) });
  return ok({ cnpj: resultado.data, fonte: resultado.fonte });
}

export async function handleCpf(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const cpf = onlyNumbers(url.searchParams.get('cpf') || '');
  if (!isValidCpf(cpf)) return err('CPF inválido.', 400, 'CPF_INVALIDO');

  let resultado;
  const nasc = onlyNumbers(url.searchParams.get('nasc') || '');
  // Serpro CPF v3 exige o nascimento (ddmmaaaa); sem ele, usa a base gratuita
  if (serproEnabled(env) && nasc.length === 8) {
    resultado = await serpro.consultarCpf(env, cpf, nasc);
  }
  if (!resultado || !resultado.ok) {
    resultado = await consultarCpfReceita(env, cpf);
  }
  if (!resultado.ok) return json(resultado, 404);
  return ok({ cpf: resultado.data, fonte: resultado.fonte });
}

export async function handleCep(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const cep = onlyNumbers(url.searchParams.get('cep') || '');
  if (cep.length !== 8) return err('CEP inválido.', 400, 'CEP_INVALIDO');
  const resultado = await consultarCep(env, cep);
  if (!resultado.ok) return json(resultado, 404);
  return ok({ cep: resultado.data, fonte: resultado.fonte });
}

// ============ SPEDY ============

export async function handleSpedy(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'status';

  if (!spedyEnabled(env)) {
    return json({ ok: false, code: 'SPEDY_NAO_CONFIGURADO', message: 'Spedy não configurada. Defina o secret SPEDY_API_KEY.' }, 503);
  }

  switch (acao) {
    case 'empresas': {
      const r = await spedy.listarEmpresas(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'cidades': {
      const r = await spedy.cidadesNfse(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'notas': {
      const tipo = url.searchParams.get('tipo') || 'nfse';
      const r = tipo === 'nfse' ? await spedy.listarNfse(env) : tipo === 'nfe' ? await spedy.listarNfe(env) : await spedy.listarNfce(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'entradas': {
      const r = await spedy.listarEntradasNfe(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'status-sync': {
      const r = await spedy.statusSincronizacao(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'produtos': {
      const r = await spedy.listarProdutos(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'clientes': {
      const r = await spedy.listarClientes(env);
      return json(r, r.ok ? 200 : 502);
    }
    default:
      return ok({ spedy: 'online', ambiente: env.SPEDY_SANDBOX === 'true' ? 'sandbox' : 'producao' });
  }
}

// ============ ZAPSIGN CERTIFICADOS ============

export async function handleZapsign(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'status';

  if (!zapsignEnabled(env)) {
    return json({ ok: false, code: 'ZAPSIGN_NAO_CONFIGURADO', message: 'ZapSign não configurada. Defina o secret ZAPSIGN_API_KEY.' }, 503);
  }

  switch (acao) {
    case 'saldo': {
      const r = await zapsign.saldo(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'produtos': {
      const r = await zapsign.produtos(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'protocolos': {
      const r = await zapsign.listarProtocolos(env);
      return json(r, r.ok ? 200 : 502);
    }
    case 'horarios': {
      const r = await zapsign.horarios(env, { date: url.searchParams.get('data') || '' });
      return json(r, r.ok ? 200 : 502);
    }
    default:
      return ok({ zapsign: 'online' });
  }
}

// Criação de protocolo de certificado digital (e-CPF / e-CNPJ)
export async function handleZapsignProtocolo(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!zapsignEnabled(env)) {
    return json({ ok: false, code: 'ZAPSIGN_NAO_CONFIGURADO', message: 'ZapSign não configurada. Defina o secret ZAPSIGN_API_KEY.' }, 503);
  }
  const body = await readBody(request);

  if (body.tipo === 'e_cpf') {
    const payload = montarProtocoloEcpf({
      cpf: body.cpf,
      nascimento: body.nascimento,
      email: body.email,
      telefone: body.telefone,
      endereco: {
        cep: onlyNumbers(body.endereco?.cep || ''),
        street: body.endereco?.rua || '',
        number: String(body.endereco?.numero || 'S/N'),
        neighborhood: body.endereco?.bairro || '',
        city: body.endereco?.cidade || '',
        state: body.endereco?.uf || '',
      },
      externalId: `ianf-${auth.user.id}-${Date.now()}`,
    });
    const r = await zapsign.criarProtocolo(env, payload);
    if (r.ok) {
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'CERTIFICADO_ECPF', detalhe: `protocolo ${r.data?.id || ''}`, ip: getIp(request) });
    }
    return json(r, r.ok ? 201 : 502);
  }

  if (body.tipo === 'e_cnpj') {
    const payload = montarProtocoloEcnpj({
      cnpj: body.cnpj,
      representante: {
        cpf: onlyNumbers(body.representante?.cpf || ''),
        birth_date: body.representante?.nascimento,
        email: body.representante?.email,
        phone: body.representante?.telefone,
        address: {
          cep: onlyNumbers(body.representante?.endereco?.cep || ''),
          street: body.representante?.endereco?.rua || '',
          number: String(body.representante?.endereco?.numero || 'S/N'),
          neighborhood: body.representante?.endereco?.bairro || '',
          city: body.representante?.endereco?.cidade || '',
          state: body.representante?.endereco?.uf || '',
        },
      },
      externalId: `ianf-${auth.user.id}-${Date.now()}`,
    });
    const r = await zapsign.criarProtocolo(env, payload);
    if (r.ok) {
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'CERTIFICADO_ECNPJ', detalhe: `protocolo ${r.data?.id || ''}`, ip: getIp(request) });
    }
    return json(r, r.ok ? 201 : 502);
  }

  return err('Tipo de certificado inválido (use e_cpf ou e_cnpj).', 400, 'TIPO_INVALIDO');
}

// Verificação de titular antes de criar protocolo
export async function handleZapsignVerificar(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!zapsignEnabled(env)) {
    return json({ ok: false, code: 'ZAPSIGN_NAO_CONFIGURADO', message: 'ZapSign não configurada.' }, 503);
  }
  const body = await readBody(request);
  const payload = body.tipo === 'pj'
    ? { type: 'pj', cnpj: onlyNumbers(body.cnpj || ''), representative: { cpf: onlyNumbers(body.cpf || ''), birth_date: body.nascimento } }
    : { type: 'pf', cpf: onlyNumbers(body.cpf || ''), birth_date: body.nascimento };
  const r = await zapsign.verificarTitular(env, payload);
  return json(r, r.ok ? 200 : 502);
}

// ============ SERPRO (PIN / DÍVIDA ATIVA / IA) ============

const SERPRO_LOJA = 'https://loja.serpro.gov.br';

// Serpro devolve valores em formato pt-BR ("2.403,59") — Number() direto daria NaN
function moedaBr(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizarInscricoes(d) {
  const raw = Array.isArray(d) ? d : d.inscricoes || d.listaInscricoes || d.dividasAtivas || d.data || [];
  return (Array.isArray(raw) ? raw : [raw].filter(Boolean)).map((i) => ({
    numero: i.numeroInscricao || i.inscricao || '',
    situacao: i.situacaoDescricao || i.situacao || '',
    origem: i.origemDebito || i.orgaoOrigem || i.origem || i.descricaoOrigem || '',
    valor: moedaBr(i.valorTotalConsolidadoMoeda || i.valorConsolidado || 0),
    dataInscricao: i.dataInscricao || '',
    devedor: i.nomeDevedor || '',
    unidade: i.nomeUnidade || i.nomePFNResponsavel || '',
    processo: i.numeroProcesso || i.processoAdministrativo || '',
  }));
}

// ============ SERPRO: normalizadores detalhados (schemas OpenAPI + respostas reais) ============

function cd(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return [v.codigo, v.descricao].filter((x) => x != null && x !== '').join(' - ');
}

function foneSerpro(t = {}) {
  return t.ddd ? `(${t.ddd}) ${t.numero || ''}` : String(t.numero || '');
}

function enderecoSerpro(e = {}) {
  return [e.tipoLogradouro, e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ');
}

function normalizarCnpjSerpro(d = {}) {
  const e = d.endereco || {};
  return {
    cnpj: d.ni || '',
    tipo_estabelecimento: !d.tipoEstabelecimento ? '' : (String(d.tipoEstabelecimento) === '1' ? 'Matriz' : `Filial (${d.tipoEstabelecimento})`),
    razao_social: d.nomeEmpresarial || '',
    nome_fantasia: d.nomeFantasia || '',
    situacao_cadastral: cd(d.situacaoCadastral),
    situacao_codigo: d.situacaoCadastral?.codigo || '',
    situacao_data: d.situacaoCadastral?.data || '',
    situacao_motivo: d.situacaoCadastral?.motivo || '',
    natureza_juridica: cd(d.naturezaJuridica),
    data_abertura: d.dataAbertura || '',
    cnae_principal: cd(d.cnaePrincipal),
    cnae_secundarias: (d.cnaeSecundarias || []).map(cd),
    endereco: enderecoSerpro(e),
    bairro: e.bairro || '',
    municipio: e.municipio?.descricao || (typeof e.municipio === 'string' ? e.municipio : ''),
    municipio_codigo: e.municipio?.codigo || '',
    uf: e.uf || '',
    cep: e.cep || '',
    pais: cd(e.pais),
    municipio_jurisdicao: cd(d.municipioJurisdicao),
    telefones: (d.telefones || []).map(foneSerpro),
    email: d.correioEletronico || '',
    capital_social: d.capitalSocial ?? '',
    porte: d.porte || '',
    situacao_especial: d.situacaoEspecial || '',
    data_situacao_especial: d.dataSituacaoEspecial || '',
    socios: (d.socios || []).map((s) => ({
      nome: s.nome || s.nomeSocio || '',
      qualificacao: cd(s.qualificacao),
      faixa_etaria: cd(s.faixaEtaria),
      condicao: cd(s.condicao),
    })),
    informacoes_adicionais: d.informacoesAdicionais || null,
  };
}

function normalizarCpfSerpro(d = {}) {
  return {
    cpf: d.ni || '',
    nome: d.nome || '',
    nome_social: d.nomeSocial || '',
    situacao: cd(d.situacao),
    situacao_codigo: d.situacao?.codigo || '',
    nascimento: d.nascimento || '',
    data_inscricao: d.dataInscricao || '',
  };
}

function enderNfe(e = {}) {
  return [e.xLgr, e.nro, e.xBairro, e.xMun, e.UF, e.CEP].filter(Boolean).join(', ');
}

function normalizarNfeSerpro(d = {}) {
  const proc = d.nfeProc || d;
  const prot = proc.protNFe?.infProt || {};
  const inf = proc.NFe?.infNFe || proc.infNFe || {};
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const tot = inf.total?.ICMSTot || {};
  const dets = [].concat(inf.det || []);
  const vols = [].concat(inf.transp?.vol || []);
  const dup = [].concat(inf.pag?.detPag || inf.pag?.dup || []);
  return {
    chave: prot.chNFe || ide.chNFe || '',
    situacao_processamento: [prot.cStat, prot.xMotivo].filter(Boolean).join(' · '),
    numero_protocolo: prot.nProt || '',
    ambiente: prot.tpAmb ? (String(prot.tpAmb) === '1' ? 'Produção' : 'Homologação') : '',
    data_recebimento: prot.dhRecbto || '',
    versao_aplicacao: prot.verAplic || '',
    modelo: ide.mod || '', serie: ide.serie || '', numero: ide.nNF || '',
    natureza_operacao: ide.natOp || '',
    tipo: ide.tpNF ? (String(ide.tpNF) === '0' ? 'Entrada' : 'Saída') : '',
    data_emissao: ide.dhEmi || '',
    destino_operacao: cd({ descricao: ide.idDest === '1' ? 'Internacional' : ide.idDest === '2' ? 'Interestadual' : ide.idDest === '3' ? 'Municipal' : '' }),
    finalidade: ide.finNFe ? ({ '1': 'Normal', '2': 'Complementar', '3': 'Ajuste', '4': 'Devolução' }[ide.finNFe] || ide.finNFe) : '',
    emissor: { documento: emit.CNPJ || emit.CPF || '', nome: emit.xNome || '', fantasia: emit.xFant || '', inscricao_estadual: emit.IE || '', endereco: enderNfe(emit.enderEmit || {}) },
    destinatario: { documento: dest.CNPJ || dest.CPF || '', nome: dest.xNome || '', endereco: enderNfe(dest.enderDest || {}), email: dest.email || '' },
    valores: {
      produtos: moedaBr(tot.vProd), frete: moedaBr(tot.vFrete), seguro: moedaBr(tot.vSeg), desconto: moedaBr(tot.vDesc),
      icms: moedaBr(tot.vICMS), icms_st: moedaBr(tot.vST), ipi: moedaBr(tot.vIPI), pis: moedaBr(tot.vPIS), cofins: moedaBr(tot.vCOFINS),
      importacao: moedaBr(tot.vII), outros: moedaBr(tot.vOutro), total_nota: moedaBr(tot.vNF),
    },
    itens: dets.map((x) => ({
      item: x.nItem || '', codigo: x.prod?.cProd || '', descricao: x.prod?.xProd || '',
      ncm: x.prod?.NCM || '', cfop: x.prod?.CFOP || '', unidade: x.prod?.uCom || '',
      quantidade: x.prod?.qCom || '', valor_unitario: moedaBr(x.prod?.vUni), valor: moedaBr(x.prod?.vProd),
    })).slice(0, 100),
    volumes: vols.map((v) => ({ especie: v.especie || v['espécie'] || '', marcas: v.marca || '', numeracao: v.nVol || '', peso_liquido: v.pesoL || '', peso_bruto: v.pesoB || '' })),
    pagamentos: dup.map((p) => ({ forma: p.tPag ? ({ '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja', '06': 'Outros', '08': 'PIX', '09': 'Transferência' }[p.tPag] || p.tPag) : '', valor: moedaBr(p.vPag), descricao: p.xPag || '' })).slice(0, 30),
    informacoes_adicionais: inf.infAdic?.infCpl || inf.infAdic?.infFisco || '',
  };
}

function bytesParaTexto(v) {
  if (v == null || v === '') return '';
  try {
    const bin = atob(String(v));
    let ctrl = 0;
    for (let i = 0; i < bin.length; i++) {
      const c = bin.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
    }
    if (bin.length && ctrl / bin.length > 0.1) return '(conteúdo assinado ICP-Brasil — base64)';
    return bin;
  } catch {
    return String(v);
  }
}

function dadosCompartilha(bloco) {
  if (!bloco) return null;
  const arr = Array.isArray(bloco) ? bloco : (bloco.dados || [bloco]);
  return (Array.isArray(arr) ? arr : []).map((x) => ({
    codigo: x.codigo || '', texto: x.texto || '', valor: x.valor || '', valorTexto: bytesParaTexto(x.valor),
  }));
}

function normalizarCompartilha(d = {}) {
  const blocos = {};
  for (const k of ['dadosSimplesNacionalPgdasd', 'dadosSimplesNacionalDefis', 'dadosMeiDasnSimei', 'dadosMeiPgmei', 'dadosCnpj', 'dadosEcf', 'dadosPronampe']) {
    const b = dadosCompartilha(d[k]);
    if (b) blocos[k] = b;
  }
  const a = d.autorizacao || null;
  return {
    autorizacao: a ? { token: a.token || '', titular: a.titular || '', destinatario: a.destinatario || '', dataHoraRegistro: a.dataHoraRegistro || '', avisoLegal: a.avisoLegal || '' } : null,
    servico: d.servico || '', idServico: d.idServico || '', versao: d.versao || '',
    dados: dadosCompartilha(d.dados) || [],
    blocos,
    possuiErro: d.possuiErro, mensagem: d.mensagem || '',
  };
}

function normalizarAutorizacoesCompartilha(d = {}) {
  const lista = Array.isArray(d) ? d : (d.autorizacoes || []);
  return {
    autorizacoes: lista.map((a) => ({
      ni: a.ni || '', token: a.token || '', status: a.status || '',
      dataHoraStatus: a.dataHoraStatus || '', vigenciaInicial: a.dataHoraVigenciaInicial || '', vigenciaFinal: a.dataHoraVigenciaFinal || '',
      idServico: a.idServico || '', versao: a.versao || '',
      hashStatus: a.hashAssinadoPadraoIcpBrasilStatus || '', avisoLegal: a.avisoLegal || '',
      parametrosAdicionais: a.parametrosAdicionais || null,
    })),
    errorResponse: d.errorResponse || '',
  };
}

function normalizarCndSerpro(d = {}) {
  const c = d.Certidao || null;
  const pdf = c?.DocumentoPdf || '';
  return {
    status: d.Status ?? null,
    mensagem: d.Messagem || d.Mensagem || '',
    tipoContribuinte: c?.TipoContribuinte ?? '',
    contribuinte: c?.ContribuinteCertidao || '',
    tipoCertidao: c?.['TipoCertidão'] ?? c?.TipoCertidao ?? '',
    codigoControle: c?.CodigoControle || '',
    dataEmissao: c?.DataEmissao || '',
    dataValidade: c?.DataValidade || '',
    temPdf: Boolean(pdf),
    pdfBase64: pdf,
  };
}

function normalizarDueSerpro(d = {}) {
  return {
    numero: d.numero || '', ruc: d.ruc || '', chaveAcesso: d.chaveDeAcesso || '',
    situacao: d.situacao || '', canal: d.canal || '', situacaoDaCarga: d.situacaoDaCarga || '',
    bloqueadaParaEmbarque: String(d.bloqueadaParaEmbarque ?? ''), exigencia: d.exigencia || '',
    retificada: String(d.retificada ?? ''), tratamentoAdministrativo: d.tratamentoAdministrativo || '',
    tipoDocumentoFiscal: d.tipoDeDocumentoFiscal || '', declarante: cd(d.declarante),
    operadorAutorizado: cd(d.operadorEconomicoAutorizado), formaExportacao: d.formaDeExportacao || '',
    paisImportador: cd(d.paisDoImportador), exportacaoConsorciada: String(d.exportacaoConsorciada ?? ''),
    pesoLiquidoTotal: d.pesoLiquidoTotal || '', valorMercadorias: moedaBr(d.valorTotalDasMercadorias),
    moeda: d.moeda || '', localEmbarque: cd(d.localDeEmbarque), localDespacho: cd(d.localDeDespacho),
    totalItens: (d.itens || []).length, totalEventos: (d.eventosDoHistorico || []).length,
    itens: (d.itens || []).slice(0, 60), eventos: (d.eventosDoHistorico || []).slice(0, 60),
  };
}

function normalizarCcir(d = {}) {
  const controle = d.dadosControleCcir || d.dadosUltimoCcir || {};
  return {
    codigo_imovel: d.codigoImovelIncra || '', denominacao: d.denominacao || '',
    area_total: d.areaTotal || '', area_registrada: d.totalAreaRegistrada || '',
    area_certificada: d.areaCertificada || '', area_modulo_fiscal: d.areaModuloFiscal || '',
    area_modulo_rural: d.areaModuloRural || '', numero_modulos_fiscais: d.numeroModulosFiscais || '',
    fracao_minima: d.fracaoMinimaParcelamento || '', classificacao_fundiaria: cd(d.classificacaoFundiaria),
    municipio_sede: d.municipioSede || '', uf_sede: d.ufSede || '',
    pessoas_relacionadas: d.totalPessoasRelacionadasImovel || '',
    situacao_ccir: controle.situacaoCcir || '', numero_ccir: controle.numeroCcir || '',
    autenticidade: controle.numeroAutenticidadeCcir || '',
    data_geracao: controle.dataGeracaoCcir || '', data_lancamento: controle.dataLancamento || '',
    data_vencimento: controle.dataVencimentoCcir || '',
    valor_total: moedaBr(controle.valorTotal), valor_cobrado: moedaBr(controle.valorCobrado),
    juros: moedaBr(controle.juros), multa: moedaBr(controle.multa), debitados_anteriores: controle.debitosAnteriores || '',
    titulares: (d.titulares || []).map((t) => ({
      nome: t.nomeTitular || '', documento: t.cpfCnpj || '', condicao: t.condicaoTitularidade || '',
      percentual: t.percentualDetencao || '', declarante: String(t.declarante ?? ''), nacionalidade: t.nacionalidade || '',
    })),
    areas_registradas: (d.areasRegistradas || []).map((a) => ({
      area: a.area || '', registro: a.registro || '', cns_oficio: a.cnsOuOficio || '',
      municipio_cartorio: a.municipioCartorio || '', uf_cartorio: a.ufCartorio || '',
      livro_ficha: a.livroOuFicha || '', matricula: a.matriculaOuTranscricao || '', data_registro: a.dataRegistro || '',
    })),
  };
}

export async function handleSerpro(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  if (!serproEnabled(env)) {
    return json({ ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET.', lojaUrl: SERPRO_LOJA }, 503);
  }

  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'status';
  const ip = getIp(request);

  const falha = async (r, detalhe) => {
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_FALHA', detalhe, ip });
    if (r.code === 'SERPRO_SEM_ASSINATURA') {
      return json({ ...r, lojaUrl: SERPRO_LOJA, message: r.message }, 503);
    }
    return json(r, r.code === 'SERPRO_AUTH' ? 503 : 502);
  };

  if (acao !== 'ia' && acao !== 'status') {
    if (!(await rateLimit(env, ip, 'serpro'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');
  }

  switch (acao) {
    case 'cnpj': {
      const cnpj = onlyNumbers(url.searchParams.get('cnpj') || '');
      if (!isValidCnpj(cnpj)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
      const modo = ['basica', 'qsa', 'empresa'].includes(url.searchParams.get('modo')) ? url.searchParams.get('modo') : 'basica';
      const r = await serpro.consultarCnpj(env, cnpj, modo);
      if (!r.ok) return falha(r, `cnpj ${cnpj} ${modo} ${r.code || ''}`);
      const d = r.data || {};
      const resumo = normalizarCnpjSerpro(d);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_CNPJ', detalhe: `${cnpj} ${modo} ${r.ambiente}`, ip });
      return ok({
        cnpj: {
          ...resumo,
          // aliases legados (consumidos pelo autofill do Emissor)
          razao_social: resumo.razao_social, nome_fantasia: resumo.nome_fantasia,
          situacao_cadastral: resumo.situacao_cadastral, uf: resumo.uf, municipio: resumo.municipio,
          logradouro: resumo.endereco, numero: '', bairro: resumo.bairro, cep: resumo.cep,
          telefone: resumo.telefones[0] || '', email: resumo.email,
          capital_social: resumo.capital_social, socios: resumo.socios,
        },
        resumo,
        dados: d,
        detalhes: d,
        modo,
        ambiente: r.ambiente,
        fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro PIN (Receita Federal)'} · CNPJ v2 ${modo}`,
      });
    }
    case 'cpf': {
      const cpf = onlyNumbers(url.searchParams.get('cpf') || '');
      if (!isValidCpf(cpf)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
      const nasc = onlyNumbers(url.searchParams.get('nasc') || '');
      if (nasc.length !== 8) return err('Informe o nascimento (ddmmaaaa) — obrigatório na Consulta CPF v3 do Serpro.', 400, 'NASC_INVALIDO');
      const r = await serpro.consultarCpf(env, cpf, nasc);
      if (!r.ok) return falha(r, `cpf ${cpf} ${r.code || ''}`);
      const d = r.data || {};
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_CPF', detalhe: cpf, ip });
      return ok({ cpf: normalizarCpfSerpro(d), resumo: normalizarCpfSerpro(d), detalhes: d, ambiente: r.ambiente, situacao: d.situacao || null, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro PIN (Receita Federal)'} · CPF v3` });
    }
    case 'situacao-cpf': {
      const cpf = onlyNumbers(url.searchParams.get('cpf') || '');
      if (!isValidCpf(cpf)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
      const nasc = onlyNumbers(url.searchParams.get('nasc') || '');
      if (nasc.length !== 8) return err('Informe o nascimento (ddmmaaaa) — obrigatório na Consulta CPF v3 do Serpro.', 400, 'NASC_INVALIDO');
      const r = await serpro.situacaoCpf(env, cpf, nasc);
      if (!r.ok) return falha(r, `situacao-cpf ${cpf} ${r.code || ''}`);
      const d = r.data || {};
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_SITUACAO_CPF', detalhe: cpf, ip });
      return ok({ cpf, resumo: normalizarCpfSerpro(d), situacao: d.situacao || d, detalhes: d, ambiente: r.ambiente, fonte: 'Serpro (Situação Cadastral do CPF)' });
    }
    case 'nfe': {
      const chave = onlyNumbers(url.searchParams.get('chave') || '');
      if (chave.length !== 44) return err('Chave de acesso da NF-e inválida (44 dígitos).', 400, 'CHAVE_INVALIDA');
      const r = await serpro.consultarNfe(env, chave);
      if (!r.ok) return falha(r, `nfe ${chave} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_NFE', detalhe: `${chave} ${r.ambiente}`, ip });
      return ok({ resumo: normalizarNfeSerpro(r.data || {}), nfe: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Consulta NF-e` });
    }
    case 'cnd': {
      const body = await readBody(request);
      const tipo = Number(body.tipo || url.searchParams.get('tipo') || 0);
      if (![1, 2, 3].includes(tipo)) return err('Tipo de contribuinte inválido (1=PF, 2=PJ, 3=NIRF).', 400, 'TIPO_INVALIDO');
      const contribuinte = onlyNumbers(body.contribuinte || url.searchParams.get('contribuinte') || '');
      if (![8, 11, 14].includes(contribuinte.length)) return err('Contribuinte inválido (NIRF 8, CPF 11 ou CNPJ 14 dígitos).', 400, 'DOC_INVALIDO');
      const r = await serpro.consultarCnd(env, {
        tipoContribuinte: tipo,
        contribuinte,
        codigoIdentificacao: body.codigoIdentificacao,
        gerarPdf: body.pdf === true || body.pdf === 'true',
      });
      if (!r.ok) return falha(r, `cnd ${contribuinte} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_CND', detalhe: `${contribuinte} ${r.ambiente}`, ip });
      const cnd = normalizarCndSerpro(r.data || {});
      const { pdfBase64, ...resumoCnd } = cnd;
      const detalhes = { ...(r.data || {}) };
      if (detalhes.Certidao && detalhes.Certidao.DocumentoPdf) {
        detalhes.Certidao = { ...detalhes.Certidao, DocumentoPdf: `[PDF base64 · ${Math.round(detalhes.Certidao.DocumentoPdf.length / 1024)} KB · disponível para download]` };
      }
      return ok({ resumo: resumoCnd, temPdf: cnd.temPdf, pdfBase64, detalhes, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Certidão Negativa de Débitos (PGFN)` });
    }
    case 'due': {
      const numero = String(url.searchParams.get('numero') || '').trim().toUpperCase();
      const chave = String(url.searchParams.get('chave') || '').trim().toUpperCase();
      if (!numero || !chave) return err('Informe o número e a chave de acesso da DUE.', 400, 'DUE_INVALIDO');
      const r = await serpro.consultarDue(env, numero, chave);
      if (!r.ok) return falha(r, `due ${numero} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_DUE', detalhe: `${numero} ${r.ambiente}`, ip });
      return ok({ resumo: normalizarDueSerpro(r.data || {}), due: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Declaração Única de Exportação (DUE)` });
    }
    case 'faturamento':
    case 'faturamento-autorizacoes': {
      const tipo = url.searchParams.get('acao') === 'faturamento-autorizacoes' ? 'autorizacoes'
        : (['consultar', 'autorizacoes'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'consultar');
      let r;
      if (tipo === 'autorizacoes') {
        const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
        const niTitularDados = onlyNumbers(url.searchParams.get('titular') || '');
        if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
        if (niTitularDados.length !== 11) return err('CPF do titular inválido.', 400, 'CPF_INVALIDO');
        r = await serpro.autorizacoesFaturamento(env, niContratante, niTitularDados);
      } else {
        const token = String(url.searchParams.get('token') || '').trim();
        const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
        if (!token) return err('Informe o token de autorização (e-CAC → Compartilha).', 400, 'TOKEN_INVALIDO');
        if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
        r = await serpro.consultarFaturamento(env, token, niContratante);
      }
      if (!r.ok) return falha(r, `faturamento ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_FATURAMENTO', detalhe: `${tipo} ${r.ambiente}`, ip });
      const resumo = tipo === 'autorizacoes' ? normalizarAutorizacoesCompartilha(r.data || {}) : normalizarCompartilha(r.data || {});
      return ok({ resumo, dados: tipo === 'autorizacoes' ? resumo : r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Consulta Faturamento (Compartilha RFB)` });
    }
    case 'compras': {
      const chaveCompra = String(url.searchParams.get('compra') || '').trim();
      if (!chaveCompra) return err('Informe a chave da compra.', 400, 'COMPRA_INVALIDA');
      const diligencias = url.searchParams.get('tipo') === 'diligencias';
      const r = await serpro.comprasChat(env, chaveCompra, { diligencias });
      if (!r.ok) return falha(r, `compras ${chaveCompra} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_COMPRAS', detalhe: `${chaveCompra} ${diligencias ? 'diligencias' : 'chat'}`, ip });
      return ok({ mensagens: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: `Serpro - Compras.gov.br (${diligencias ? 'diligências' : 'chat'})` });
    }
    case 'contador': {
      const body = await readBody(request);
      const operacao = ['Consultar', 'Declarar', 'Emitir', 'Monitorar', 'Apoiar'].includes(body.operacao) ? body.operacao : 'Consultar';
      let dados = body.dados;
      if (typeof dados === 'string') {
        try { dados = JSON.parse(dados); } catch { return err('DadosEntrada precisa ser um JSON válido.', 400, 'JSON_INVALIDO'); }
      }
      if (!dados || typeof dados !== 'object') return err('Informe o DadosEntrada (JSON).', 400, 'DADOS_INVALIDOS');
      const r = await serpro.contador(env, operacao, { jwtToken: body.jwtToken || '', dados });
      if (!r.ok) return falha(r, `contador ${operacao} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONTADOR', detalhe: operacao, ip });
      return ok({ retorno: r.data, operacao, fonte: 'Serpro - Integra Contador (procuração e-CAC)' });
    }
    case 'carimbo': {
      const body = await readBody(request);
      const base64 = String(body.base64 || '').trim();
      if (!base64) return err('Informe o timestamp em base64.', 400, 'CARIMBO_INVALIDO');
      const r = await serpro.carimboTempo(env, { base64, document: Array.isArray(body.document) ? body.document : undefined });
      if (!r.ok) return falha(r, `carimbo ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CARIMBO', detalhe: base64.slice(0, 40), ip });
      return ok({ verificacao: r.data, resumo: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Carimbo de Tempo (x-signature)` });
    }
    case 'comex': {
      const body = await readBody(request);
      const servico = ['container', 'presenca', 'habitacao'].includes(url.searchParams.get('servico')) ? url.searchParams.get('servico') : 'container';
      const jwtToken = String(body.jwtToken || env.SERPRO_COMEX_JWT || '');
      let r;
      if (servico === 'container') {
        const numeros = (Array.isArray(body.numeros) ? body.numeros : String(body.numero || url.searchParams.get('numero') || '').split(','))
          .map((n) => String(n).trim()).filter(Boolean).slice(0, 10);
        if (!numeros.length) return err('Informe ao menos um número de contêiner.', 400, 'CONTEINER_INVALIDO');
        r = await serpro.comexContainer(env, numeros, jwtToken);
      } else if (servico === 'presenca') {
        const nic = String(body.nic || url.searchParams.get('nic') || '').trim();
        const recinto = String(body.recinto || url.searchParams.get('recinto') || '').trim();
        if (!nic || !recinto) return err('Informe NIC e recinto.', 400, 'PRESENCA_INVALIDA');
        r = await serpro.comexPresenca(env, { nic, recinto }, jwtToken);
      } else {
        const cnpj = onlyNumbers(body.cnpj || url.searchParams.get('cnpj') || '');
        if (!isValidCnpj(cnpj)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
        r = await serpro.comexHabilitacao(env, cnpj, jwtToken);
      }
      if (!r.ok) return falha(r, `comex ${servico} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_COMEX', detalhe: servico, ip });
      return ok({ comex: r.data, servico, fonte: `Serpro - Integra Comex (${servico})` });
    }
    case 'cartorio': {
      const ni = onlyNumbers(url.searchParams.get('ni') || '');
      const modo = ['cpf', 'basica', 'qsa', 'empresa'].includes(url.searchParams.get('modo')) ? url.searchParams.get('modo') : 'basica';
      if (modo === 'cpf' && (ni.length !== 11 || !isValidCpf(ni))) return err('CPF inválido.', 400, 'CPF_INVALIDO');
      if (modo !== 'cpf' && (ni.length !== 14 || !isValidCnpj(ni))) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
      const r = await serpro.consultarCpfCnpj(env, modo, ni);
      if (!r.ok) return falha(r, `cartorio ${modo} ${ni} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CARTORIO', detalhe: `${ni} ${modo} ${r.ambiente}`, ip });
      const d = r.data || {};
      const resumo = modo === 'cpf' ? normalizarCpfSerpro(d) : normalizarCnpjSerpro(d);
      return ok({ resumo, consulta: d, detalhes: d, modo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Cartório Data (Consulta CPF/CNPJ v2)` });
    }
    case 'renda': {
      const tipo = ['consultar', 'autorizacoes', 'status'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'consultar';
      let r;
      if (tipo === 'status') {
        r = await serpro.rendaStatus(env);
      } else if (tipo === 'autorizacoes') {
        const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
        const niTitularDados = onlyNumbers(url.searchParams.get('titular') || '');
        if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
        if (niTitularDados.length !== 11) return err('CPF do titular inválido.', 400, 'CPF_INVALIDO');
        r = await serpro.rendaAutorizacoes(env, niContratante, niTitularDados);
      } else {
        const token = String(url.searchParams.get('token') || '').trim();
        if (!token) return err('Informe o token de autorização (e-CAC → Compartilha).', 400, 'TOKEN_INVALIDO');
        r = await serpro.rendaCpf(env, token);
      }
      if (!r.ok) return falha(r, `renda ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_RENDA', detalhe: `${tipo} ${r.ambiente}`, ip });
      const resumo = tipo === 'autorizacoes' ? normalizarAutorizacoesCompartilha(r.data || {})
        : tipo === 'status' ? { status: r.data }
        : normalizarCompartilha(r.data || {});
      return ok({ resumo, renda: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Renda PF (Declaração IRPF)` });
    }
    case 'restituicao': {
      const tipo = ['consultar', 'autorizacoes', 'status'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'consultar';
      let r;
      if (tipo === 'status') {
        r = await serpro.restituicaoStatus(env);
      } else if (tipo === 'autorizacoes') {
        const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
        const niTitularDados = onlyNumbers(url.searchParams.get('titular') || '');
        if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
        if (niTitularDados.length !== 11) return err('CPF do titular inválido.', 400, 'CPF_INVALIDO');
        r = await serpro.restituicaoAutorizacoes(env, niContratante, niTitularDados);
      } else {
        const token = String(url.searchParams.get('token') || '').trim();
        if (!token) return err('Informe o token de autorização (e-CAC → Compartilha).', 400, 'TOKEN_INVALIDO');
        r = await serpro.restituicaoCpf(env, token);
      }
      if (!r.ok) return falha(r, `restituicao ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_RESTITUICAO', detalhe: `${tipo} ${r.ambiente}`, ip });
      const resumo = tipo === 'autorizacoes' ? normalizarAutorizacoesCompartilha(r.data || {})
        : tipo === 'status' ? { status: r.data }
        : normalizarCompartilha(r.data || {});
      return ok({ resumo, restituicao: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Restituição IRPF` });
    }
    case 'datavalid': {
      const body = await readBody(request);
      const cpf = onlyNumbers(body.cpf || url.searchParams.get('cpf') || '');
      if (cpf.length !== 11) return err('CPF inválido (11 dígitos).', 400, 'CPF_INVALIDO');
      const nascRaw = onlyNumbers(body.nasc || '');
      let nasc = '';
      if (nascRaw) {
        const m = /^(\d{2})(\d{2})(\d{4})$/.exec(nascRaw);
        nasc = nascRaw.length === 8 && !m ? nascRaw : (m ? m[1] + m[2] + m[3] : '');
        if (nasc.length !== 8) return err('Nascimento inválido (dd/mm/aaaa).', 400, 'NASC_INVALIDO');
      }
      const nome = String(body.nome || '').trim();
      const validacao = {};
      if (nome) validacao.nome = nome;
      if (nasc) validacao.data_nascimento = nasc;
      const privacidade = { rfb: body.rfb === true || body.rfb === 'true', senatran: body.senatran === true || body.senatran === 'true' };
      if (!privacidade.rfb && !privacidade.senatran) privacidade.rfb = true;
      const r = await serpro.datavalidValidar(env, { cpf, privacidade, validacao });
      if (!r.ok) return falha(r, `datavalid ${cpf} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_DATAVALID', detalhe: cpf, ip });
      return ok({ validacao: r.data, resumo: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Datavalid v5 (validação de identidade)` });
    }
    case 'datavalid-status': {
      const r = await serpro.datavalidStatus(env);
      if (!r.ok) return falha(r, `datavalid-status ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_DATAVALID_STATUS', detalhe: 'status', ip });
      return ok({ status: r.data, fonte: 'Serpro - Datavalid v5 (status)' });
    }
    case 'biovalid': {
      const body = await readBody(request);
      const cpf = onlyNumbers(body.cpf || url.searchParams.get('cpf') || '');
      if (cpf.length !== 11) return err('CPF inválido.', 400, 'CPF_INVALIDO');
      const servico = body.servico === 'liveness' ? 'liveness' : 'token';
      let r;
      if (servico === 'liveness') {
        const pin = String(body.pin || '').trim();
        const device = String(body.device || '').trim();
        if (!pin || !device) return err('PIN e identificador do dispositivo são obrigatórios na prova de vida.', 400, 'LIVENESS_INVALIDO');
        r = await serpro.biovalidLiveness(env, { cpf, pin, device, selfie: body.selfie, sexo: body.sexo, cnh: body.cnh });
      } else {
        r = await serpro.biovalidToken(env, { cpf, expiraEm: body.expiraEm, tentativas: body.tentativas });
      }
      if (!r.ok) return falha(r, `biovalid ${servico} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_BIOVALID', detalhe: servico, ip });
      return ok({ biovalid: r.data, servico, fonte: `Serpro - BioValid (${servico === 'liveness' ? 'prova de vida' : 'token'})` });
    }
    case 'antecipa': {
      // Antecipa Gov — Portal de Operações (somente LEITURA; mutações ficam fora do IANF)
      const tipo = ['cotacoes', 'proposta', 'contrato', 'dadosbasicos', 'situacaonivel', 'regularidade', 'ocorrencias', 'historico', 'arquivo'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'cotacoes';
      const id = String(url.searchParams.get('id') || '').trim();
      const ident = onlyNumbers(url.searchParams.get('ni') || '');
      const uasg = String(url.searchParams.get('uasg') || '').trim();
      const contrato = String(url.searchParams.get('contrato') || '').trim();
      const nivel = ['detalhada', 'nadaconsta', 'impeditivasindiretas'].includes(url.searchParams.get('nivel')) ? url.searchParams.get('nivel') : 'detalhada';
      let sub;
      if (tipo === 'cotacoes') sub = '/v2/cotacoesdisponiveis';
      else if (tipo === 'proposta') { if (!id) return err('Informe o ID da cotação.', 400, 'ID_INVALIDO'); sub = `/v2/cotacao/${encodeURIComponent(id)}/proposta`; }
      else if (tipo === 'contrato') { if (!id || !contrato || !uasg) return err('Informe cotação, UASG e número do contrato.', 400, 'ID_INVALIDO'); sub = `/v2/cotacao/${encodeURIComponent(id)}/contrato/${encodeURIComponent(contrato)}/${encodeURIComponent(uasg)}`; }
      else if (tipo === 'arquivo') { if (!id) return err('Informe o código do arquivo.', 400, 'ID_INVALIDO'); sub = `/v2/arquivo/${encodeURIComponent(id)}`; }
      else {
        if (!ident) return err('Informe o CPF/CNPJ do fornecedor (identificador).', 400, 'NI_INVALIDO');
        if (tipo === 'dadosbasicos') sub = `/v2/dadosbasicos/${ident}`;
        else if (tipo === 'situacaonivel') sub = `/v2/dadossituacaonivel/${ident}`;
        else if (tipo === 'regularidade') sub = `/v2/regularidadefiscalfinanceira/${ident}`;
        else if (tipo === 'ocorrencias') sub = `/v2/ocorrencias/${nivel}/${ident}`;
        else sub = `/v2/historicofornecedor/${ident}`;
      }
      const r = await serpro.antecipaLer(env, sub);
      if (!r.ok) return falha(r, `antecipa ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_ANTECIPA', detalhe: `${tipo} ${r.ambiente}`, ip });
      return ok({ resumo: r.data, antecipa: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Antecipa Gov (Portal de Operações)` });
    }
    case 'pilar': {
      // Antecipa Gov — PILAR (fornecedor / UASG), somente LEITURA
      const tipo = ['avaliacao', 'contratos', 'ordembancaria', 'cotacao', 'documento', 'cronograma', 'empenhos', 'faturas', 'historico', 'itens', 'empenho', 'operacoes', 'operacao'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'avaliacao';
      const id = String(url.searchParams.get('id') || '').trim();
      const uasg = String(url.searchParams.get('uasg') || '').trim();
      const contrato = String(url.searchParams.get('contrato') || '').trim();
      let sub;
      if (tipo === 'avaliacao') {
        const ni = onlyNumbers(url.searchParams.get('ni') || '');
        if (ni.length !== 11 && ni.length !== 14) return err('Informe um CPF (11) ou CNPJ (14) do fornecedor.', 400, 'NI_INVALIDO');
        if (ni.length === 11 && !isValidCpf(ni)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
        if (ni.length === 14 && !isValidCnpj(ni)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
        sub = `/v2/avaliacao/fornecedor/${ni}`;
      } else if (tipo === 'contratos') {
        if (!id) return err('Informe o ID do contrato.', 400, 'ID_INVALIDO');
        sub = `/v2/execucoes/contratos/${encodeURIComponent(id)}`;
      } else if (tipo === 'ordembancaria') {
        if (!id) return err('Informe o ID de apropriação da ordem bancária.', 400, 'ID_INVALIDO');
        sub = `/v2/ordembancaria/consultar/${encodeURIComponent(id)}`;
      } else if (tipo === 'operacoes') {
        sub = '/v2/operacao-credito';
      } else if (tipo === 'operacao') {
        if (!id) return err('Informe o ID da operação de crédito.', 400, 'ID_INVALIDO');
        sub = `/v2/operacao-credito/${encodeURIComponent(id)}`;
      } else {
        if (!id || !uasg) return err('Informe a cotação e a UASG.', 400, 'ID_INVALIDO');
        const base = `/v2/cotacao/${encodeURIComponent(id)}/uasg/${encodeURIComponent(uasg)}`;
        if (tipo === 'cotacao' || tipo === 'documento' || tipo === 'cronograma' || tipo === 'empenhos' || tipo === 'faturas' || tipo === 'historico' || tipo === 'itens') {
          if (!contrato) return err('Informe o número do contrato.', 400, 'ID_INVALIDO');
          sub = `${base}/contrato/${encodeURIComponent(contrato)}${tipo === 'cotacao' ? '' : `/${tipo}`}`;
        } else {
          if (!contrato) return err('Informe o número do empenho.', 400, 'ID_INVALIDO');
          sub = `${base}/empenho/${encodeURIComponent(contrato)}`;
        }
      }
      const r = await serpro.pilarLer(env, sub);
      if (!r.ok) return falha(r, `pilar ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_PILAR', detalhe: `${tipo} ${r.ambiente}`, ip });
      return ok({ resumo: r.data, pilar: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - Antecipa Gov (PILAR)` });
    }
    case 'ccir': {
      // CCIR - Certificado de Cadastro de Imóvel Rural (INCRA)
      const tipo = ['codigo', 'ni', 'emitir', 'status'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'ni';
      let r;
      if (tipo === 'status') {
        r = await serpro.ccirStatus(env);
      } else if (tipo === 'ni') {
        const ni = onlyNumbers(url.searchParams.get('ni') || '');
        if (ni.length !== 11 && ni.length !== 14) return err('Informe um CPF (11) ou CNPJ (14) do titular do imóvel rural.', 400, 'NI_INVALIDO');
        r = await serpro.ccirPorNi(env, ni);
      } else {
        const codigo = String(url.searchParams.get('codigo') || '').trim().toUpperCase();
        if (!codigo) return err('Informe o código do imóvel (11 dígitos, INCRA).', 400, 'CODIGO_INVALIDO');
        r = tipo === 'emitir' ? await serpro.ccirEmitir(env, encodeURIComponent(codigo)) : await serpro.ccirPorCodigo(env, encodeURIComponent(codigo));
      }
      if (!r.ok) return falha(r, `ccir ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CCIR', detalhe: `${tipo} ${r.ambiente}`, ip });
      const resumo = tipo === 'codigo' || tipo === 'emitir' ? normalizarCcir(r.data || {}) : r.data;
      return ok({ resumo, ccir: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - CCIR (INCRA)` });
    }
    case 'nfe-escalonada': {
      const chave = onlyNumbers(url.searchParams.get('chave') || '');
      if (chave.length !== 44) return err('Chave de acesso da NF-e inválida (44 dígitos).', 400, 'CHAVE_INVALIDA');
      const r = await serpro.nfeEscalonadaConsultar(env, chave);
      if (!r.ok) return falha(r, `nfe-escalonada ${chave} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_NFE_ESCALONADA', detalhe: chave, ip });
      return ok({ resumo: r.data, nfe: r.data, detalhes: r.data, ambiente: r.ambiente, fonte: 'Serpro - NF-e Escalonada (processamento em lote)' });
    }
    case 'nfe-push': {
      const tipo = ['status', 'listar', 'criar', 'excluir', 'clientes'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'status';
      const body = await readBody(request);
      let r;
      if (tipo === 'status') {
        r = await serpro.nfeStatus(env);
      } else if (tipo === 'clientes') {
        r = await serpro.nfePushClientes(env);
      } else if (tipo === 'listar') {
        r = await serpro.nfePushListar(env);
      } else if (tipo === 'excluir') {
        const id = String(body.id || url.searchParams.get('id') || '').trim();
        if (!id) return err('Informe o ID do monitoramento.', 400, 'ID_INVALIDO');
        r = await serpro.nfePushExcluir(env, encodeURIComponent(id));
      } else {
        const chaves = (Array.isArray(body.chaves) ? body.chaves : String(body.chaves || '').split(/[\n,;\s]+/))
          .map((c) => onlyNumbers(String(c))).filter((c) => c.length === 44).slice(0, 500);
        if (!chaves.length) return err('Informe ao menos uma chave de acesso válida (44 dígitos).', 400, 'CHAVE_INVALIDA');
        r = await serpro.nfePushCriar(env, chaves);
      }
      if (!r.ok) return falha(r, `nfe-push ${tipo} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_NFE_PUSH', detalhe: `${tipo} ${r.ambiente}`, ip });
      return ok({ resumo: r.data, push: r.data, detalhes: r.data, tipo, ambiente: r.ambiente, fonte: `${r.ambiente === 'demo' ? 'Serpro · demonstração' : 'Serpro'} - NF-e push (${tipo})` });
    }
    case 'divida-ativa': {
      const ni = onlyNumbers(url.searchParams.get('ni') || '');
      // A base de demonstração da PGFN usa CPFs/CNPJs fictícios; vale só o formato (dígitos).
      if (ni.length !== 11 && ni.length !== 14) return err('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).', 400, 'NI_INVALIDO');
      const r = await serpro.consultarDividaAtiva(env, ni);
      if (!r.ok) return falha(r, `divida-ativa ${ni} ${r.code || ''}`);
      const origem = r.ambiente === 'demo' ? 'trial' : 'prod';
      const inscricoes = normalizarInscricoes(r.data || {});
      const ativas = inscricoes.filter((i) => String(i.situacao).toUpperCase() !== 'EXTINTA');
      const total = ativas.reduce((s, i) => s + i.valor, 0);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_DIVIDA_ATIVA', detalhe: `${ni} ${origem}`, ip });
      return ok({
        ni,
        situacao: inscricoes.length === 0 ? 'sem_registros' : ativas.length === 0 ? 'regular' : 'com_debitos',
        totalConsolidado: total,
        inscricoes,
        detalhes: r.data,
        ambiente: origem,
        fonte: origem === 'trial'
          ? 'PGFN / Serpro - Dívida Ativa (ambiente de demonstração)'
          : 'PGFN / Serpro - Dívida Ativa da União',
      });
    }
    case 'divida-inscricao': {
      const numero = onlyNumbers(url.searchParams.get('numero') || '');
      if (numero.length < 6 || numero.length > 20) return err('Informe o número da inscrição (somente dígitos).', 400, 'INSCRICAO_INVALIDA');
      const r = await serpro.consultarInscricao(env, numero);
      if (!r.ok) return falha(r, `divida-inscricao ${numero} ${r.code || ''}`);
      const origem = r.ambiente === 'demo' ? 'trial' : 'prod';
      const raw = r.data || {};
      const d = Array.isArray(raw) ? (raw[0] || {}) : raw;
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_DIVIDA_INSCRICAO', detalhe: `${numero} ${origem}`, ip });
      return ok({
        inscricao: {
          numero: d.inscricao || d.numeroInscricao || numero,
          situacao: d.situacao || d.situacaoDescricao || '',
          origem: d.orgaoOrigem || d.nomeNaturezaReceita || d.nomeReceita || '',
          dataInscricao: d.dataInscricao || '',
          valorTotalInscrito: moedaBr(d.valorTotalInscritoMoeda),
          valorConsolidado: moedaBr(d.valorTotalConsolidadoMoeda),
          valorRemanescente: moedaBr(d.valorRemanescenteMoeda),
          processo: d.processoAdministrativo || d.numeroProcessoJudicial || '',
          unidade: d.nomePFNResponsavel || d.nomeUnidade || '',
        },
        detalhes: d,
        ambiente: origem,
        fonte: origem === 'trial'
          ? 'PGFN / Serpro - Inscrição da Dívida Ativa (ambiente de demonstração)'
          : 'PGFN / Serpro - Inscrição da Dívida Ativa',
      });
    }
    case 'ia': {
      if (!(await rateLimit(env, ip, 'ai'))) return err('Limite de análises atingido.', 429, 'RATE_LIMIT');
      const body = await readBody(request);
      const prompt = String(body.prompt || '').trim().slice(0, 4000);
      if (!prompt) return err('Informe o prompt da análise.', 400, 'PROMPT_INVALIDO');
      const r = await serpro.ia(env, { prompt, contexto: body.contexto });
      if (!r.ok) return falha(r, `ia ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_IA', detalhe: prompt.slice(0, 80), ip });
      const d = r.data || {};
      return ok({
        resposta: d.resposta || d.resultado || d.choices?.[0]?.message?.content || d.content || d,
        fonte: 'Serpro IA',
      });
    }
    default:
      return ok({
        serpro: 'online',
        lojaUrl: SERPRO_LOJA,
        demonstracao: Boolean(env.SERPRO_TRIAL_TOKEN),
        servicos: [
          { acao: 'cnpj', nome: 'Consulta CNPJ v2 (basica/qsa/empresa)' },
          { acao: 'cpf', nome: 'Consulta CPF v3 (Receita Federal)' },
          { acao: 'situacao-cpf', nome: 'Situação Cadastral do CPF' },
          { acao: 'divida-ativa', nome: 'Dívida Ativa da União (PGFN)' },
          { acao: 'divida-inscricao', nome: 'Inscrição da Dívida Ativa (número)' },
          { acao: 'nfe', nome: 'Consulta NF-e (chave de acesso)' },
          { acao: 'nfe-escalonada', nome: 'NF-e Escalonada (lote)' },
          { acao: 'nfe-push', nome: 'NF-e push (status/clientes/listar/criar/excluir)' },
          { acao: 'cnd', nome: 'Certidão Negativa de Débitos (CND + PDF)' },
          { acao: 'due', nome: 'Declaração Única de Exportação (DUE)' },
          { acao: 'faturamento', nome: 'Faturamento (Consultar/Autorizações - Compartilha RFB)' },
          { acao: 'compras', nome: 'Compras.gov.br (chat/diligências)' },
          { acao: 'contador', nome: 'Integra Contador (procuração e-CAC)' },
          { acao: 'carimbo', nome: 'Carimbo de Tempo (verificação x-signature)' },
          { acao: 'comex', nome: 'Integra Comex (contêiner/presença/habilitação)' },
          { acao: 'cartorio', nome: 'Cartório Data (Consulta CPF/CNPJ v2)' },
          { acao: 'ccir', nome: 'CCIR - Imóvel Rural (INCRA)' },
          { acao: 'renda', nome: 'Renda PF (Consultar/Autorizações/status)' },
          { acao: 'restituicao', nome: 'Restituição IRPF (Consultar/Autorizações/status)' },
          { acao: 'datavalid', nome: 'Datavalid v5 (validação de identidade)' },
          { acao: 'datavalid-status', nome: 'Datavalid v5 (status)' },
          { acao: 'biovalid', nome: 'BioValid (biometria facial)' },
          { acao: 'antecipa', nome: 'Antecipa Gov - Portal (cotações/propostas/fornecedor)' },
          { acao: 'pilar', nome: 'Antecipa Gov - PILAR (avaliação/contratos/UASG)' },
          { acao: 'ia', nome: 'Serpro IA (análise fiscal)' },
        ],
      });
  }
}

// ============ PGFN / REGULARIZE (Dívida Ativa da União) ============

const PGFN_LINKS = [
  { nome: 'Regularize PGFN (portal oficial)', url: 'https://www.regularize.pgfn.gov.br/', descricao: 'Consulta de débitos, emissão de DARF/DAS/DAE, parcelamento e transação tributária (login gov.br)' },
  { nome: 'Lista de Devedores da PGFN', url: 'https://www.gov.br/pt-br/servicos/consultar-lista-de-devedores-da-pgfn', descricao: 'Consulta pública de inscrições em dívida ativa da União e do FGTS' },
  { nome: 'Dados Abertos da PGFN', url: 'https://www.gov.br/pgfn/pt-br/assuntos/divida-ativa-da-uniao/transparencia-fiscal-1/dados-abertos', descricao: 'Dados trimestrais da dívida ativa (Portaria PGFN nº 636/2020)' },
  { nome: 'Contratar API Dívida Ativa (Serpro)', url: 'https://www.loja.serpro.gov.br/consulta-divida-ativa', descricao: 'API oficial para consultas automatizadas via gateway Serpro' },
];

export async function handlePgfn(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'links';

  if (acao === 'links') {
    return ok({ servicos: PGFN_LINKS, portal: 'https://www.regularize.pgfn.gov.br/' });
  }

  const ni = onlyNumbers(url.searchParams.get('ni') || '');
  if (ni.length !== 11 && ni.length !== 14) return err('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).', 400, 'NI_INVALIDO');
  if (ni.length === 11 && !isValidCpf(ni)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
  if (ni.length === 14 && !isValidCnpj(ni)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
  if (!(await rateLimit(env, getIp(request), 'cnpj'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');

  if (!serproEnabled(env)) {
    return json({
      ok: false,
      code: 'SERPRO_NAO_CONFIGURADO',
      message: 'Consulta automatizada requer a API Dívida Ativa da Serpro (loja.serpro.gov.br/consulta-divida-ativa). Enquanto isso, use o portal Regularize.',
      links: PGFN_LINKS,
    }, 503);
  }

  const r = await serpro.consultarDividaAtiva(env, ni);
  if (!r.ok) return json({ ...r, links: PGFN_LINKS }, 502);

  // Normaliza a resposta (os nomes dos campos variam conforme a versão da API)
  const d = r.data || {};
  const raw = Array.isArray(d) ? d : d.inscricoes || d.listaInscricoes || d.data || [];
  const inscricoes = (Array.isArray(raw) ? raw : []).map((i) => ({
    numero: i.numeroInscricao || i.inscricao || '',
    situacao: i.situacaoDescricao || i.situacao || '',
    origem: i.origemDebito || i.origem || i.descricaoOrigem || '',
    valor: Number(i.valorTotalConsolidadoMoeda || i.valorConsolidado || 0),
    dataInscricao: i.dataInscricao || '',
  }));
  const ativas = inscricoes.filter((i) => String(i.situacao).toUpperCase() !== 'EXTINTA');
  const total = ativas.reduce((s, i) => s + i.valor, 0);

  await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'CONSULTA_DIVIDA_ATIVA', detalhe: ni, ip: getIp(request) });
  return ok({
    ni,
    situacao: inscricoes.length === 0 ? 'sem_registros' : ativas.length === 0 ? 'regular' : 'com_debitos',
    totalConsolidado: total,
    inscricoes,
    fonte: 'PGFN / Serpro - Dívida Ativa da União',
    links: PGFN_LINKS,
  });
}

// ============ SERASA EXPERIAN (VERIFY PF/PJ) ============

export async function handleSerasa(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!serasaEnabled(env)) {
    return json({ ok: false, code: 'SERASA_NAO_CONFIGURADO', message: 'Serasa não configurada. Gere clientId/clientSecret no portal (client-identities) e defina os secrets SERASA_CLIENT_ID e SERASA_CLIENT_SECRET (ou SERASA_TOKEN como fallback).' }, 503);
  }
  if (!(await rateLimit(env, getIp(request), 'serasa'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');

  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'pf';
  const body = await readBody(request);
  const doc = onlyNumbers(body.document || url.searchParams.get('document') || '');

  let resultado;
  if (acao === 'pf') {
    // Validação por tamanho apenas: documentos de teste da Serasa (ex.: 99999999999) não têm DV válido
    if (!/^\d{11}$/.test(doc)) return err('CPF inválido (11 dígitos).', 400, 'CPF_INVALIDO');
    const person = {
      document: doc,
      name: String(body.name || '').slice(0, 120) || undefined,
      socialName: String(body.socialName || '').slice(0, 120) || undefined,
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(body.birthDate || '') ? body.birthDate : undefined,
      motherName: String(body.motherName || '').slice(0, 120) || undefined,
      email: String(body.email || '').slice(0, 120) || undefined,
    };
    const end = body.address || {};
    if (end.street || end.zipCode) {
      person.address = {
        street: String(end.street || '').slice(0, 120),
        number: String(end.number || '').slice(0, 20),
        city: String(end.city || '').slice(0, 80),
        state: String(end.state || '').slice(0, 2).toUpperCase(),
        neighborhood: String(end.neighborhood || '').slice(0, 80),
        zipCode: onlyNumbers(end.zipCode || '').slice(0, 8),
      };
    }
    const tel = body.phone || {};
    if (tel.areaCode || tel.number) {
      person.phone = { areaCode: String(tel.areaCode || '').slice(0, 3), number: String(tel.number || '').slice(0, 12) };
    }
    resultado = await verificarPessoa(env, person);
  } else if (acao === 'pj') {
    // Validação por tamanho apenas: documentos de teste da Serasa (ex.: 99999999999999) não têm DV válido
    if (!/^\d{14}$/.test(doc)) return err('CNPJ inválido (14 dígitos).', 400, 'CNPJ_INVALIDO');
    const business = {
      document: doc,
      companyName: String(body.companyName || '').slice(0, 160) || undefined,
      fantasyName: String(body.fantasyName || '').slice(0, 160) || undefined,
      email: String(body.email || '').slice(0, 120) || undefined,
      openingDate: /^\d{4}-\d{2}-\d{2}$/.test(body.openingDate || '') ? body.openingDate : undefined,
    };
    const end = body.address || {};
    if (end.street || end.zipCode) {
      business.address = {
        street: String(end.street || '').slice(0, 120),
        number: String(end.number || '').slice(0, 20),
        city: String(end.city || '').slice(0, 80),
        state: String(end.state || '').slice(0, 2).toUpperCase(),
        neighborhood: String(end.neighborhood || '').slice(0, 80),
        zipCode: onlyNumbers(end.zipCode || '').slice(0, 8),
      };
    }
    if (Array.isArray(body.partners)) {
      business.partners = body.partners.slice(0, 20).map((p) => ({ document: onlyNumbers(p.document || ''), partnerName: String(p.partnerName || '').slice(0, 120) }));
    }
    if (Array.isArray(body.phones)) {
      business.phones = body.phones.slice(0, 5).map((p) => ({ areaCode: String(p.areaCode || '').slice(0, 3), number: String(p.number || '').slice(0, 12) }));
    }
    resultado = await verificarEmpresa(env, business);
  } else {
    return err('Ação inválida (use pf ou pj).', 400, 'ACAO_INVALIDA');
  }

  if (!resultado.ok) {
    const status = resultado.code === 'SERASA_TOKEN_EXPIRADO' ? 401 : 502;
    return json(resultado, status);
  }
  await audit(env, { userId: auth.user.id, email: auth.user.email, acao: `SERASA_VERIFY_${acao.toUpperCase()}`, detalhe: doc, ip: getIp(request) });
  return ok({
    verificacao: normalizarVerificacao(resultado.data),
    fonte: 'Serasa Experian - Verify (Verificação de Dados PF/PJ)',
  });
}

// ============ APIBRASIL (DADOS CNPJ POR CRÉDITO) ============

export async function handleApibrasil(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!apibrasilEnabled(env)) {
    return json({ ok: false, code: 'APIBRASIL_NAO_CONFIGURADO', message: 'APIBrasil não configurada. Defina o secret APIBRASIL_TOKEN.' }, 503);
  }

  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'saldo';
  const body = await readBody(request);

  if (acao === 'saldo') {
    if (!(await rateLimit(env, getIp(request), 'apibrasil'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');
    const r = await apibrasilSaldo(env);
    if (!r.ok) return json(r, 502);
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'APIBRASIL_SALDO', detalhe: r.saldo, ip: getIp(request) });
    return ok({ saldo: r.saldo, user: r.user, rechargeUrl: r.rechargeUrl, fonte: 'APIBrasil' });
  }

  if (acao === 'cnpj') {
    const cnpj = onlyNumbers(body.cnpj || url.searchParams.get('cnpj') || '');
    if (!isValidCnpj(cnpj)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
    const tipo = ['cnpj', 'lista-socios'].includes(body.tipo) ? body.tipo : 'cnpj';
    if (!(await rateLimit(env, getIp(request), 'apibrasil'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');
    const r = await apibrasilConsultarCnpj(env, cnpj, tipo);
    if (!r.ok) {
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'APIBRASIL_CONSULTA_FALHA', detalhe: `${cnpj} ${r.code || ''}`, ip: getIp(request) });
      // Sem saldo? Gera cobrança PIX (InfinitePay) para o usuário pagar a consulta na hora
      if (r.code === 'SALDO_INSUFICIENTE' && infinitepayEnabled(env)) {
        const cobranca = await criarCobrancaConsulta(env, request, auth.user, {
          tipo: 'apibrasil', consulta: tipo, parametros: { cnpj, tipo },
          valorConsulta: r.valorConsulta || 0.04, descricao: 'Consulta IANF · APIBrasil',
        });
        if (cobranca) {
          return json({
            ok: false, code: 'SALDO_INSUFICIENTE',
            message: 'Saldo APIBrasil esgotado. Pague esta consulta via PIX para liberar.',
            checkout_url: cobranca.checkout_url, order_nsu: cobranca.order_nsu,
            valor: cobranca.valorCents / 100, valorCents: cobranca.valorCents, saldo: r.saldo,
          }, 402);
        }
      }
      const payload = {
        ...r,
        message: r.data?.message || r.message,
        saldo: r.saldo || r.data?.balance || null,
        rechargeUrl: r.rechargeUrl || (String(r.data?.recharge_url || '').startsWith('https://app.apibrasil.io') ? r.data.recharge_url : null),
      };
      return json(payload, payload.code === 'SALDO_INSUFICIENTE' ? 402 : 502);
    }
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'APIBRASIL_CONSULTA_CNPJ', detalhe: cnpj, ip: getIp(request) });
    return ok({ dados: r.dados, balance: r.balance, valorConsulta: r.valorConsulta, fonte: 'APIBrasil' });
  }

  if (acao === 'pagar-consulta') {
    const orderNsu = String(body.order_nsu || '');
    if (!orderNsu) return err('order_nsu obrigatório.', 400, 'ORDER_INVALIDO');
    if (!(await rateLimit(env, getIp(request), 'pix'))) return err('Limite de verificações atingido.', 429, 'RATE_LIMIT');
    const pg = await env.DB.prepare('SELECT * FROM pagamentos_consulta WHERE order_nsu = ? AND user_id = ?')
      .bind(orderNsu, auth.user.id).first();
    if (!pg) return err('Cobrança não encontrada.', 404, 'COBRANCA_NAO_ENCONTRADA');

    if (pg.status !== 'pago' && infinitepayEnabled(env)) {
      try {
        const slug = String(pg.checkout_url || '').split('/').filter(Boolean).pop() || '';
        const check = await consultarPagamento(env, { orderNsu, slug });
        const status = String(check?.status || '').toLowerCase();
        const pago = check?.paid === true || ['paid', 'settled', 'concluido', 'aprovado'].includes(status);
        if (pago) {
          await env.DB.prepare("UPDATE pagamentos_consulta SET status = 'pago', transaction_nsu = ?, paid_at = ? WHERE id = ?")
            .bind(String(check.transaction_nsu || check.transactionNsu || ''), new Date().toISOString(), pg.id).run();
          pg.status = 'pago';
          await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'CONSULTA_PAGA_PIX', detalhe: `${pg.tipo} ${orderNsu}`, ip: getIp(request) });
        }
      } catch (e) {
        console.error('[IANF] Verificação de pagamento da consulta:', e.message);
      }
    }

    if (pg.status !== 'pago') return ok({ status: 'pendente' });

    // Pago: reexecuta a consulta com os parâmetros originais
    const params = JSON.parse(pg.parametros || '{}');
    if (pg.tipo === 'apibrasil') {
      const r2 = await apibrasilConsultarCnpj(env, params.cnpj, params.tipo || 'cnpj');
      if (!r2.ok) {
        await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'APIBRASIL_CONSULTA_FALHA', detalhe: `${params.cnpj} ${r2.code || ''}`, ip: getIp(request) });
        const payload = {
          ...r2,
          message: r2.code === 'SALDO_INSUFICIENTE'
            ? 'Pagamento aprovado! Mas o saldo APIBrasil continua esgotado — o operador precisa recarregar a conta para concluir a consulta.'
            : (r2.data?.message || r2.message || 'Falha ao executar a consulta paga.'),
          saldo: r2.saldo || null,
        };
        return json(payload, payload.code === 'SALDO_INSUFICIENTE' ? 402 : 502);
      }
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'APIBRASIL_CONSULTA_CNPJ', detalhe: params.cnpj, ip: getIp(request) });
      return ok({ pago: true, dados: r2.dados, balance: r2.balance, valorConsulta: r2.valorConsulta, fonte: 'APIBrasil' });
    }

    return err('Tipo de consulta não suportado para reexecução.', 400, 'TIPO_INVALIDO');
  }

  return err('Ação inválida (use saldo, cnpj ou pagar-consulta).', 400, 'ACAO_INVALIDA');
}

// Cria a cobrança PIX da consulta (valor + margem de 10%, mínimo R$ 0,05) e registra o pagamento pendente
async function criarCobrancaConsulta(env, request, user, { tipo, consulta, parametros, valorConsulta, descricao }) {
  const valorCents = Math.max(5, Math.ceil(Number(valorConsulta || 0.04) * 110));
  const orderNsu = `IANF-Q-${user.id}-${Date.now()}`;
  let host = new URL(request.url).origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(host)) host = env.IANF_URL || '';
  const webhookUrl = host.startsWith('https://') ? `${host}/api/webhooks/infinitepay` : undefined;

  const link = await criarLinkCheckout(env, {
    valorCents,
    descricao,
    orderNsu,
    cliente: { name: user.name || user.email, email: user.email },
    webhookUrl,
    validUntil: new Date(Date.now() + 3600 * 1000).toISOString(),
    metodos: ['pix'],
  }).catch((e) => {
    console.error('[IANF] Infinitepay cobrança de consulta:', e.message);
    return null;
  });

  const checkoutUrl = link && (link.url || link.checkout_url || link.link);
  if (!checkoutUrl) return null;

  await env.DB.prepare(`
    INSERT INTO pagamentos_consulta (user_id, tipo, consulta, parametros, valor_cents, status, checkout_url, order_nsu)
    VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?)
  `).bind(user.id, tipo, consulta, JSON.stringify(parametros), valorCents, checkoutUrl, orderNsu).run();

  await audit(env, { userId: user.id, email: user.email, acao: 'CONSULTA_COBRADA_PIX', detalhe: `${tipo} ${orderNsu} ${valorCents}`, ip: getIp(request) });
  return { checkout_url: checkoutUrl, order_nsu: orderNsu, valorCents };
}

// ============ DIRECTDATA (CONSULTAS BIG DATA POR CONSUMO) ============

export async function handleDirectdata(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!directdataEnabled(env)) {
    return json({ ok: false, code: 'DIRECTDATA_NAO_CONFIGURADO', message: 'DirectData não configurada. Pegue o token em app.directd.com.br → Configurações → Integrações e defina o secret DIRECTDATA_TOKEN.' }, 503);
  }

  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'consultar';
  const body = await readBody(request);

  if (acao === 'consultar') {
    const endpoint = String(body.endpoint || '').trim();
    if (!validarEndpoint(endpoint)) return err('Endpoint inválido (use apenas o nome, ex: CadastroPessoaFisica).', 400, 'ENDPOINT_INVALIDO');
    if (!(await rateLimit(env, getIp(request), 'directdata'))) return err('Limite de consultas atingido.', 429, 'RATE_LIMIT');
    const r = await directdataConsultar(env, endpoint, body.params || {});
    if (!r.ok) {
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'DIRECTDATA_CONSULTA_FALHA', detalhe: `${endpoint} ${r.status || r.code || ''}`, ip: getIp(request) });
      return json(r, r.code === 'SALDO_INSUFICIENTE' ? 402 : 502);
    }
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'DIRECTDATA_CONSULTA', detalhe: endpoint, ip: getIp(request) });
    return ok({ endpoint, metaDados: r.metaDados, retorno: r.retorno, fonte: 'DirectData' });
  }

  return err('Ação inválida (use consultar).', 400, 'ACAO_INVALIDA');
}
