import { json, ok, err, readBody, rateLimit, getIp } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { gerarInsight, assistente, classificarLancamento, analisarNotaFiscal } from '../lib/ai.js';
import { resumoDRE } from '../lib/fiscal.js';

export async function handleInsight(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!(await rateLimit(env, getIp(request), 'ai'))) return err('Limite de IA atingido. Aguarde.', 429, 'RATE_LIMIT');

  const { results } = await env.DB.prepare('SELECT tipo, valor FROM lancamentos WHERE user_id = ?').bind(auth.user.id).all();
  const dre = resumoDRE(results);
  const resultado = await gerarInsight(env, dre);
  if (!resultado.ok) return json(resultado, 502);
  return ok({ insight: resultado.insight, dre });
}

export async function handleChat(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!(await rateLimit(env, getIp(request), 'ai'))) return err('Limite de IA atingido. Aguarde.', 429, 'RATE_LIMIT');

  const body = await readBody(request);
  const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
  if (!mensagem) return err('Mensagem vazia.', 400, 'MSG_VAZIA');

  // Contexto financeiro do usuário para respostas personalizadas
  const { results } = await env.DB.prepare('SELECT tipo, slot, valor, descricao FROM lancamentos WHERE user_id = ? ORDER BY id DESC LIMIT 100').bind(auth.user.id).all();
  const dre = resumoDRE(results);
  const contexto = `[Contexto financeiro do usuário: receita ${dre.receita}, despesas ${dre.despesa}, lucro líquido ${dre.lucroLiquido}]`;
  const mensagemFinal = `${contexto} ${mensagem}`;

  const historico = Array.isArray(body.historico) ? body.historico.slice(-10) : [];
  const resultado = await assistente(env, historico, mensagemFinal);
  if (!resultado.ok) return json(resultado, 502);
  return ok({ resposta: resultado.resposta });
}

export async function handleClassificar(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const descricao = String(body.descricao || '').slice(0, 500);
  if (!descricao) return err('Descrição vazia.', 400, 'DESC_VAZIA');
  const resultado = await classificarLancamento(env, descricao);
  if (!resultado.ok) return json(resultado, 502);
  return ok({ tipo: resultado.tipo, slot: resultado.slot });
}

export async function handleAnalisarNota(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!(await rateLimit(env, getIp(request), 'ai'))) return err('Limite de IA atingido. Aguarde.', 429, 'RATE_LIMIT');
  const body = await readBody(request);
  const texto = String(body.texto || '').slice(0, 8000);
  if (!texto) return err('Nenhum conteúdo enviado.', 400, 'TEXTO_VAZIO');
  const resultado = await analisarNotaFiscal(env, texto);
  if (!resultado.ok) return json(resultado, 502);
  return ok({ dados: resultado.dados });
}
