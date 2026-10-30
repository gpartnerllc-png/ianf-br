// APIBrasil v2 - consultas pagas por crédito (CNPJ/CPF)
// Docs: https://doc.apibrasil.io | Gateway: https://gateway.apibrasil.io/api/v2
// Auth: Bearer JWT de 1 ano (secret APIBRASIL_TOKEN; base configurável via APIBRASIL_BASE_URL)
const DEFAULT_BASE = 'https://gateway.apibrasil.io/api/v2';

export function apibrasilEnabled(env) {
  return Boolean(env.APIBRASIL_TOKEN);
}

function base(env) {
  return (env.APIBRASIL_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

async function post(env, path, body) {
  try {
    const res = await fetch(`${base(env)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIBRASIL_TOKEN}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 402) {
        return { ok: false, code: 'SALDO_INSUFICIENTE', message: 'Saldo insuficiente na APIBrasil.', data };
      }
      return { ok: false, code: 'APIBRASIL_ERRO', status: res.status, message: data?.message || `APIBrasil respondeu ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: 'APIBRASIL_FALHA', message: e.message };
  }
}

// O endpoint responde error:true (HTTP 200) ou 402 quando não há saldo,
// mas sempre informa o balance — devolve o saldo em qualquer caso.
export async function saldo(env) {
  const r = await post(env, '/consulta/cnpj/credits', {});
  const d = r.data || {};
  const url = String(d.recharge_url || '').startsWith('https://app.apibrasil.io')
    ? d.recharge_url
    : 'https://app.apibrasil.io/dashboard?modal=recharge';
  if (r.ok || r.code === 'SALDO_INSUFICIENTE') {
    return {
      ok: true,
      saldo: d.balance || 'R$ 0,00',
      user: d.user || null,
      rechargeUrl: url,
    };
  }
  return r;
}

export async function consultarCnpj(env, cnpj, tipo = 'cnpj') {
  const r = await post(env, '/dados/cnpj/credits', { tipo, cnpj, homolog: false });
  if (!r.ok) return r;
  const d = r.data || {};
  if (d.error) {
    return {
      ok: false,
      code: d.balance ? 'SALDO_INSUFICIENTE' : 'APIBRASIL_ERRO',
      message: d.message || 'Erro na consulta APIBrasil.',
      saldo: d.balance || null,
      valorConsulta: d.tax ?? d.valor_consulta ?? null,
      rechargeUrl: String(d.recharge_url || '').startsWith('https://app.apibrasil.io') ? d.recharge_url : null,
    };
  }
  return {
    ok: true,
    dados: d.data || d,
    balance: d.balance || null,
    valorConsulta: d.valor_consulta ?? null,
  };
}
