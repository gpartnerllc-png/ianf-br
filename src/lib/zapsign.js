// Cliente da API Certificados ZapSign (v2/partners)
// Criação e acompanhamento de protocolos de certificado digital e-CPF/e-CNPJ (A1/A3 em nuvem)
// Docs: https://docs.certificados.zapsign.com.br | Auth: Bearer czk_live_...

const BASE = 'https://certificados.zapsign.com.br';

export function zapsignEnabled(env) {
  return Boolean(env.ZAPSIGN_API_KEY);
}

async function zsRequest(env, path, { method = 'GET', body = null } = {}) {
  if (!zapsignEnabled(env)) {
    return { ok: false, code: 'ZAPSIGN_NAO_CONFIGURADO', message: 'Integração ZapSign não configurada. Defina o secret ZAPSIGN_API_KEY.' };
  }
  const headers = { Authorization: `Bearer ${env.ZAPSIGN_API_KEY}`, Accept: 'application/json' };
  const opts = { method, headers };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${BASE}/api/v2/partners${path}`, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* vazio */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `Erro ${res.status}`;
      return { ok: false, code: 'ZAPSIGN_ERRO', message: msg, status: res.status, data };
    }
    return { ok: true, data: data ?? {}, status: res.status };
  } catch (e) {
    return { ok: false, code: 'ZAPSIGN_REDE', message: 'Falha de conexão com a ZapSign: ' + e.message };
  }
}

export const zapsign = {
  // Saldo de créditos do parceiro
  saldo: (env) => zsRequest(env, '/credits'),
  // Produtos de certificado disponíveis
  produtos: (env) => zsRequest(env, '/protocol-products'),
  // Lista protocolos (paginação)
  listarProtocolos: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return zsRequest(env, `/protocols${qs ? `?${qs}` : ''}`);
  },
  // Consulta um protocolo
  obterProtocolo: (env, protocolId) => zsRequest(env, `/protocols/${protocolId}`),
  // Cria protocolo (e-CPF ou e-CNPJ)
  criarProtocolo: (env, payload) => zsRequest(env, '/protocols', { method: 'POST', body: payload }),
  // Cancela protocolo (devolve crédito)
  cancelarProtocolo: (env, protocolId) => zsRequest(env, `/protocols/${protocolId}/cancel`, { method: 'POST', body: {} }),
  // Verifica se o titular pode emitir por videoconferência
  verificarTitular: (env, payload) => zsRequest(env, '/customer-verifications', { method: 'POST', body: payload }),
  // Lista horários de videoconferência
  horarios: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return zsRequest(env, `/appointment-slots${qs ? `?${qs}` : ''}`);
  },
  // Agenda videoconferência
  agendar: (env, protocolId, payload) => zsRequest(env, `/protocols/${protocolId}/appointment`, { method: 'POST', body: payload }),
};

// Monta payload de criação de protocolo e-CPF
export function montarProtocoloEcpf({ cpf, nascimento, email, telefone, endereco, appointment = null, externalId = null }) {
  const payload = {
    certificate: { type: 'e_cpf', model: 'a3_em_nuvem', validity_months: 12 },
    customer: {
      type: 'pf',
      cpf: String(cpf).replace(/\D/g, ''),
      birth_date: nascimento,
      email,
      phone: telefone,
      address: endereco,
    },
  };
  if (appointment) payload.appointment = appointment;
  if (externalId) payload.external_id = externalId;
  return payload;
}

// Monta payload de criação de protocolo e-CNPJ
export function montarProtocoloEcnpj({ cnpj, representante, appointment = null, externalId = null }) {
  const payload = {
    certificate: { type: 'e_cnpj', model: 'a3_em_nuvem', validity_months: 12 },
    customer: {
      type: 'pj',
      cnpj: String(cnpj).replace(/\D/g, ''),
      representative: representante,
    },
  };
  if (appointment) payload.appointment = appointment;
  if (externalId) payload.external_id = externalId;
  return payload;
}
