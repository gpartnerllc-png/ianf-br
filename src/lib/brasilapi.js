// Clientes de integração governamental e dados públicos
// BrasilAPI (gratuita) - dados da Receita Federal / Redesim (CNPJ) e CEP

const BASE = 'https://brasilapi.com.br/api';

async function cacheGet(env, key) {
  try {
    const raw = await env.KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function cachePut(env, key, data, ttl = 86400) {
  try {
    await env.KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
  } catch { /* cache é best-effort */ }
}

export async function consultarCnpj(env, cnpj) {
  const cacheKey = `cnpj:${cnpj}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return { ok: true, fonte: 'cache', data: cached };

  try {
    const res = await fetch(`${BASE}/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'IANF-Sistema-Balancos/2.0' },
    });
    if (res.status === 404) return { ok: false, code: 'CNPJ_NAO_ENCONTRADO', message: 'CNPJ não encontrado na base da Receita Federal.' };
    if (!res.ok) return { ok: false, code: 'FALHA_CONSULTA', message: `Consulta indisponível (${res.status}). Tente novamente.` };
    const data = await res.json();
    const normalizado = {
      cnpj: data.cnpj,
      razao_social: data.razao_social,
      nome_fantasia: data.nome_fantasia || '',
      situacao_cadastral: data.descricao_situacao_cadastral,
      data_situacao: data.data_situacao_cadastral,
      cnae_principal: data.cnae_fiscal_descricao,
      cnae_codigo: data.cnae_fiscal,
      uf: data.uf,
      municipio: data.municipio,
      logradouro: data.logradouro,
      numero: data.numero,
      bairro: data.bairro,
      cep: data.cep,
      telefone: data.ddd_telefone_1,
      email: data.email,
      porte: data.porte,
      natureza_juridica: data.natureza_juridica,
      capital_social: data.capital_social,
      socios: (data.qsa || []).map((s) => ({ nome: s.nome_socio || s.nome, qualificacao: s.qualificacao_socio })),
      fonte: 'Receita Federal / Redesim via BrasilAPI',
    };
    await cachePut(env, cacheKey, normalizado, 7 * 86400);
    return { ok: true, fonte: 'brasilapi', data: normalizado };
  } catch (e) {
    return { ok: false, code: 'ERRO_REDE', message: 'Erro ao consultar a Receita Federal: ' + e.message };
  }
}

export async function consultarCep(env, cep) {
  const cacheKey = `cep:${cep}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return { ok: true, fonte: 'cache', data: cached };
  try {
    const res = await fetch(`${BASE}/cep/v2/${cep}`, { headers: { 'User-Agent': 'IANF-Sistema-Balancos/2.0' } });
    if (!res.ok) return { ok: false, code: 'CEP_NAO_ENCONTRADO', message: 'CEP não encontrado.' };
    const data = await res.json();
    await cachePut(env, cacheKey, data, 30 * 86400);
    return { ok: true, fonte: 'brasilapi', data };
  } catch (e) {
    return { ok: false, code: 'ERRO_REDE', message: 'Erro ao consultar CEP: ' + e.message };
  }
}

export async function consultarCpfReceita(env, cpf) {
  // Consulta CPF na Receita (base pública via BrasilAPI, sem exposição de dados sensíveis)
  const cacheKey = `cpf:${cpf}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return { ok: true, fonte: 'cache', data: cached };
  try {
    const res = await fetch(`${BASE}/cpf/v1/${cpf}`, { headers: { 'User-Agent': 'IANF-Sistema-Balancos/2.0' } });
    if (!res.ok) return { ok: false, code: 'CPF_NAO_ENCONTRADO', message: 'CPF não encontrado.' };
    const data = await res.json();
    await cachePut(env, cacheKey, data, 7 * 86400);
    return { ok: true, fonte: 'brasilapi', data };
  } catch (e) {
    return { ok: false, code: 'ERRO_REDE', message: 'Erro ao consultar CPF: ' + e.message };
  }
}
