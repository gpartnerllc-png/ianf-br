// Sincronização com o núcleo legado (AWS Lambda) - FINALIZAR_VENDA
// A URL padrão é o endpoint público do repositório ianf-br (infra do próprio usuário).
// Pode ser sobrescrita pela var LAMBDA_SYNC_URL.

const DEFAULT_URL = 'https://4djefisdvvgqv4jl3j5x35mssi0vxfmv.lambda-url.sa-east-1.on.aws/';

export function lambdaSyncUrl(env) {
  return env.LAMBDA_SYNC_URL || DEFAULT_URL;
}

// Fire-and-forget: não bloqueia a emissão da nota nem derruba o fluxo se o Lambda estiver fora
export function syncFinalizarVenda(env, { nome, valor, documento, slot_dre }) {
  fetch(lambdaSyncUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'FINALIZAR_VENDA', nome, valor, documento, slot_dre }),
  }).then((res) => {
    if (!res.ok) console.error('[IANF] Sync Lambda FINALIZAR_VENDA respondeu', res.status);
  }).catch((e) => {
    console.error('[IANF] Sync Lambda indisponível:', e.message);
  });
}
