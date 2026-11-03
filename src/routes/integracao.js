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

  // Fonte principal: Serpro PIN (oficial). Fallback: BrasilAPI (gratuita).
  let resultado;
  if (serproEnabled(env)) {
    resultado = await serpro.consultarCnpj(env, cnpj);
    if (resultado.ok && resultado.data) {
      const d = resultado.data;
      resultado.data = {
        cnpj,
        razao_social: d.nomeEmpresarial || d.razaoSocial || d.razao_social,
        nome_fantasia: d.nomeFantasia || '',
        situacao_cadastral: d.descricaoSituacaoCadastral || d.situacaoCadastral,
        cnae_codigo: d.codigoCnaePrincipal || d.cnaeFiscal,
        cnae_principal: d.descricaoCnaePrincipal || d.cnae_principal || '',
        uf: d.uf,
        municipio: d.municipio,
        logradouro: d.logradouro || '',
        numero: d.numero || '',
        bairro: d.bairro || '',
        cep: d.cep || '',
        telefone: d.telefone || d.dddTelefone1 || '',
        email: d.email || '',
        porte: d.porte || '',
        capital_social: d.capitalSocial || d.capital_social || 0,
        socios: d.socios || [],
        fonte: 'Serpro PIN (Receita Federal)',
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
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_CNPJ', detalhe: `${cnpj} ${modo}`, ip });
      return ok({
        cnpj: {
          cnpj,
          razao_social: d.nomeEmpresarial || d.razaoSocial || d.razao_social,
          nome_fantasia: d.nomeFantasia || '',
          situacao_cadastral: d.descricaoSituacaoCadastral || d.situacaoCadastral,
          cnae_codigo: d.codigoCnaePrincipal || d.cnaeFiscal,
          cnae_principal: d.descricaoCnaePrincipal || d.cnae_principal || '',
          uf: d.uf,
          municipio: d.municipio,
          logradouro: d.logradouro || '',
          numero: d.numero || '',
          bairro: d.bairro || '',
          cep: d.cep || '',
          telefone: d.telefone || d.dddTelefone1 || '',
          email: d.email || '',
          porte: d.porte || '',
          capital_social: d.capitalSocial || d.capital_social || 0,
          socios: d.socios || [],
        },
        dados: d,
        modo,
        fonte: `Serpro PIN (Receita Federal) · ${modo}`,
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
      return ok({ cpf: d, situacao: d.situacao || null, fonte: 'Serpro PIN (Receita Federal) · CPF v3' });
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
      return ok({ cpf, situacao: d.situacao || d, fonte: 'Serpro (Situação Cadastral do CPF)' });
    }
    case 'nfe': {
      const chave = onlyNumbers(url.searchParams.get('chave') || '');
      if (chave.length !== 44) return err('Chave de acesso da NF-e inválida (44 dígitos).', 400, 'CHAVE_INVALIDA');
      const r = await serpro.consultarNfe(env, chave);
      if (!r.ok) return falha(r, `nfe ${chave} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_NFE', detalhe: chave, ip });
      return ok({ nfe: r.data, fonte: 'Serpro - Consulta NF-e (Receita Federal)' });
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
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_CND', detalhe: contribuinte, ip });
      return ok({ certidao: r.data, fonte: 'Serpro - Certidão Negativa de Débitos (PGFN)' });
    }
    case 'due': {
      const numero = String(url.searchParams.get('numero') || '').trim().toUpperCase();
      const chave = String(url.searchParams.get('chave') || '').trim().toUpperCase();
      if (!numero || !chave) return err('Informe o número e a chave de acesso da DUE.', 400, 'DUE_INVALIDO');
      const r = await serpro.consultarDue(env, numero, chave);
      if (!r.ok) return falha(r, `due ${numero} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_CONSULTA_DUE', detalhe: numero, ip });
      return ok({ due: r.data, fonte: 'Serpro - Declaração Única de Exportação (DUE)' });
    }
    case 'faturamento': {
      const token = String(url.searchParams.get('token') || '').trim();
      const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
      if (!token) return err('Informe o token de autorização (e-CAC → Compartilha).', 400, 'TOKEN_INVALIDO');
      if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
      const r = await serpro.consultarFaturamento(env, token, niContratante);
      if (!r.ok) return falha(r, `faturamento ${niContratante} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_FATURAMENTO', detalhe: niContratante, ip });
      return ok({ faturamento: r.data, fonte: 'Serpro - Consulta Faturamento (Compartilha RFB)' });
    }
    case 'faturamento-autorizacoes': {
      const niContratante = onlyNumbers(url.searchParams.get('contratante') || '');
      const niTitularDados = onlyNumbers(url.searchParams.get('titular') || '');
      if (niContratante.length !== 14) return err('CNPJ do contratante inválido.', 400, 'CNPJ_INVALIDO');
      if (niTitularDados.length !== 11) return err('CPF do titular inválido.', 400, 'CPF_INVALIDO');
      const r = await serpro.autorizacoesFaturamento(env, niContratante, niTitularDados);
      if (!r.ok) return falha(r, `faturamento-autorizacoes ${niContratante} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_FATURAMENTO_AUTORIZACOES', detalhe: niContratante, ip });
      return ok({ autorizacoes: r.data, fonte: 'Serpro - Autorizações de Faturamento (Compartilha RFB)' });
    }
    case 'compras': {
      const chaveCompra = String(url.searchParams.get('compra') || '').trim();
      if (!chaveCompra) return err('Informe a chave da compra.', 400, 'COMPRA_INVALIDA');
      const diligencias = url.searchParams.get('tipo') === 'diligencias';
      const r = await serpro.comprasChat(env, chaveCompra, { diligencias });
      if (!r.ok) return falha(r, `compras ${chaveCompra} ${r.code || ''}`);
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_COMPRAS', detalhe: `${chaveCompra} ${diligencias ? 'diligencias' : 'chat'}`, ip });
      return ok({ mensagens: r.data, fonte: `Serpro - Compras.gov.br (${diligencias ? 'diligências' : 'chat'})` });
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
      return ok({ verificacao: r.data, fonte: 'Serpro - Carimbo de Tempo (x-signature)' });
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
    case 'divida-ativa': {
      const ni = onlyNumbers(url.searchParams.get('ni') || '');
      if (ni.length !== 11 && ni.length !== 14) return err('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).', 400, 'NI_INVALIDO');
      if (ni.length === 11 && !isValidCpf(ni)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
      if (ni.length === 14 && !isValidCnpj(ni)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
      const r = await serpro.consultarDividaAtiva(env, ni);
      if (!r.ok) return falha(r, `divida-ativa ${ni} ${r.code || ''}`);
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
      await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SERPRO_DIVIDA_ATIVA', detalhe: ni, ip });
      return ok({
        ni,
        situacao: inscricoes.length === 0 ? 'sem_registros' : ativas.length === 0 ? 'regular' : 'com_debitos',
        totalConsolidado: total,
        inscricoes,
        fonte: 'PGFN / Serpro - Dívida Ativa da União',
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
        servicos: [
          { acao: 'cnpj', nome: 'Consulta CNPJ (basica/qsa/empresa)' },
          { acao: 'cpf', nome: 'Consulta CPF v3 (Receita Federal)' },
          { acao: 'situacao-cpf', nome: 'Situação Cadastral do CPF' },
          { acao: 'divida-ativa', nome: 'Dívida Ativa da União (PGFN)' },
          { acao: 'nfe', nome: 'Consulta NF-e (chave de acesso)' },
          { acao: 'cnd', nome: 'Certidão Negativa de Débitos (CND)' },
          { acao: 'due', nome: 'Declaração Única de Exportação (DUE)' },
          { acao: 'faturamento', nome: 'Consulta Faturamento (Compartilha RFB)' },
          { acao: 'faturamento-autorizacoes', nome: 'Autorizações de Faturamento' },
          { acao: 'compras', nome: 'Compras.gov.br (chat/diligências)' },
          { acao: 'contador', nome: 'Integra Contador (procuração e-CAC)' },
          { acao: 'carimbo', nome: 'Carimbo de Tempo (verificação x-signature)' },
          { acao: 'comex', nome: 'Integra Comex (contêiner/presença/habilitação)' },
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
