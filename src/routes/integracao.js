import { json, ok, err, readBody, audit, getIp, onlyNumbers, isValidCnpj, isValidCpf, rateLimit } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { consultarCnpj, consultarCep, consultarCpfReceita } from '../lib/brasilapi.js';
import { spedy, spedyEnabled, montarOrderPayload, montarNfsePayload } from '../lib/spedy.js';
import { zapsign, zapsignEnabled, montarProtocoloEcpf, montarProtocoloEcnpj } from '../lib/zapsign.js';
import { serpro, serproEnabled } from '../lib/serpro.js';
import { serasaEnabled, verificarPessoa, verificarEmpresa, normalizarVerificacao } from '../lib/serasa.js';
import { apibrasilEnabled, saldo as apibrasilSaldo, consultarCnpj as apibrasilConsultarCnpj } from '../lib/apibrasil.js';
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
  if (serproEnabled(env)) {
    resultado = await serpro.consultarCpf(env, cpf);
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

// ============ SERPRO ============

export async function handleSerpro(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const acao = url.searchParams.get('acao') || 'status';

  if (!serproEnabled(env)) {
    return json({ ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET.' }, 503);
  }

  if (acao === 'cnpj') {
    const cnpj = onlyNumbers(url.searchParams.get('cnpj') || '');
    if (!isValidCnpj(cnpj)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
    const r = await serpro.consultarCnpj(env, cnpj);
    return json(r, r.ok ? 200 : 502);
  }
  if (acao === 'cpf') {
    const cpf = onlyNumbers(url.searchParams.get('cpf') || '');
    if (!isValidCpf(cpf)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
    const r = await serpro.consultarCpf(env, cpf);
    return json(r, r.ok ? 200 : 502);
  }
  return ok({ serpro: 'online' });
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
    return json({ ok: false, code: 'SERASA_NAO_CONFIGURADO', message: 'Serasa não configurada. Defina o secret SERASA_TOKEN.' }, 503);
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

  return err('Ação inválida (use saldo ou cnpj).', 400, 'ACAO_INVALIDA');
}
