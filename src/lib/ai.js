// Workers AI - inteligência artificial do Cloudflare
// Modelos de texto (fallback automático) e funções de análise financeira/fiscal

const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/qwen/qwen3-30b-a3b-instruct-2507',
];

async function runModel(env, messages, { maxTokens = 800, temperature = 0.4 } = {}) {
  let lastError = null;
  for (const model of MODELS) {
    try {
      const result = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
      const text = typeof result === 'string' ? result : result?.response;
      if (text) return text.trim();
      lastError = new Error('resposta vazia');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Nenhum modelo de IA disponível');
}

export async function gerarInsight(env, dre) {
  const prompt = `Você é o analista fiscal do sistema IANF. Com base nos números abaixo (em R$), gere UM insight curto (máx. 2 frases, em português) com recomendação prática de negócio. Números: receita ${dre.receita}, despesas ${dre.despesa}, investimento ${dre.investimento}, impostos estimados ${dre.impostosEstimados}, lucro líquido ${dre.lucroLiquido}.`;
  try {
    const texto = await runModel(env, [
      { role: 'system', content: 'Você é um consultor financeiro/fiscal brasileiro, direto e prático.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 200, temperature: 0.5 });
    return { ok: true, insight: texto };
  } catch (e) {
    return { ok: false, insight: null, error: e.message };
  }
}

export async function classificarLancamento(env, descricao) {
  const prompt = `Classifique o lançamento financeiro brasileiro abaixo em uma categoria. Responda SOMENTE um JSON: {"tipo":"receita|despesa|investimento","slot":"pix|cartao|obras|energia|manutencao|equipamentos|pro_labore|func|taxas|servicos|outros"}. Lançamento: "${descricao}"`;
  try {
    const texto = await runModel(env, [
      { role: 'system', content: 'Você responde somente JSON válido.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 100, temperature: 0 });
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) return { ok: true, ...JSON.parse(match[0]) };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function assistente(env, historico, mensagem) {
  const system = `Você é a IANF IA, assistente do sistema IANF de balanços e notas fiscais brasileiro. Você domina: Reforma Tributária 2026 (CBS e IBS), emissão de NF-e/NFC-e/NFS-e, MEI, Simples Nacional, Lucro Presumido/Real, certificados digitais ICP-Brasil e rotinas fiscais. Responda em português, de forma clara, técnica e útil. Não invente números de alíquotas: quando necessário, cite os valores da Reforma (CBS 26,5% e IBS 17,7% no regime padrão; MEI 0,9% + 0,1%) e recomende confirmar na legislação vigente.`;
  const messages = [
    { role: 'system', content: system },
    ...historico.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: mensagem },
  ];
  try {
    const texto = await runModel(env, messages, { maxTokens: 900, temperature: 0.6 });
    return { ok: true, resposta: texto };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

export async function analisarNotaFiscal(env, texto) {
  const prompt = `Analise o texto de documento fiscal abaixo (pode ser XML ou DANFE colado) e extraia em JSON: {"emitente":"...","destinatario":"...","valor_total":0,"impostos":0,"cbs":0,"ibs":0,"numero":"...","chave":"...","data":"..."}. Se não conseguir, use null nos campos. Documento: ${String(texto).slice(0, 6000)}`;
  try {
    const saida = await runModel(env, [
      { role: 'system', content: 'Você responde somente JSON válido, sem comentários.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 500, temperature: 0 });
    const match = saida.match(/\{[\s\S]*\}/);
    return match ? { ok: true, dados: JSON.parse(match[0]) } : { ok: false, erro: 'JSON inválido' };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}
