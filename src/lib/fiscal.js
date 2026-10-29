// Módulo fiscal: Reforma Tributária 2026 - CBS (Contribuição sobre Bens e Serviços)
// e IBS (Imposto sobre Bens e Serviços), com regimes e split de arrecadação.

export const REGIMES = {
  mei: {
    label: 'MEI / Nanoempreendedor',
    descricao: 'Alíquotas reduzidas: CBS 0,9% + IBS 0,1% (monofasia simplificada).',
    cbs: 0.009,
    ibs: 0.001,
  },
  simplificado: {
    label: 'Simplificado (ME/EPP - Simples)',
    descricao: 'CBS e IBS calculados dentro do DAS conforme faixa de faturamento.',
    cbs: 0.009,
    ibs: 0.001,
  },
  padrao: {
    label: 'Regime Padrão',
    descricao: 'CBS 26,5% (federal) + IBS 17,7% (estado/município).',
    cbs: 0.265,
    ibs: 0.177,
  },
  personalizado: {
    label: 'Personalizado',
    descricao: 'Alíquotas definidas pela empresa.',
    cbs: null,
    ibs: null,
  },
};

export function alicotaSplit(ibsRate = 0.177) {
  // Split padrão IBS: 60% estado / 40% município (estimativa da reforma)
  return { estado: ibsRate * 0.6, municipio: ibsRate * 0.4 };
}

export function calcularFiscal(valor, regime = 'mei', customCbs = null, customIbs = null, env = {}) {
  const v = Math.max(0, Number(valor) || 0);

  let cbsRate, ibsRate;
  if (regime === 'personalizado') {
    cbsRate = Number(customCbs ?? env.CBS_PADRAO ?? 0.265);
    ibsRate = Number(customIbs ?? env.IBS_PADRAO ?? 0.177);
  } else if (regime === 'padrao') {
    cbsRate = Number(env.CBS_PADRAO ?? 0.265);
    ibsRate = Number(env.IBS_PADRAO ?? 0.177);
  } else {
    cbsRate = Number(env.CBS_MEI ?? 0.009);
    ibsRate = Number(env.IBS_MEI ?? 0.001);
  }

  const split = alicotaSplit(ibsRate);
  const cbs = v * cbsRate;
  const ibs = v * ibsRate;
  const ibsEstado = v * split.estado;
  const ibsMunicipio = v * split.municipio;
  const totalImpostos = cbs + ibs;
  const liquido = v - totalImpostos;

  return {
    valorBruto: round2(v),
    regime,
    cbs: { aliquota: cbsRate, valor: round2(cbs) },
    ibs: {
      aliquota: ibsRate,
      valor: round2(ibs),
      estado: { aliquota: split.estado, valor: round2(ibsEstado) },
      municipio: { aliquota: split.municipio, valor: round2(ibsMunicipio) },
    },
    totalImpostos: round2(totalImpostos),
    liquido: round2(liquido),
    cargaEfetiva: v > 0 ? totalImpostos / v : 0,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function formatarBRL(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function gerarChaveAcesso({ uf = 'SP', anoMes = '', cnpj = '', modelo = '55', serie = '1', numero = 1, tipoEmissao = '1', codigo = '' }) {
  const ano = anoMes.slice(0, 4);
  const mes = anoMes.slice(4, 6);
  const base = `${uf}${ano}${mes}${cnpj}${modelo}${serie.padStart(3, '0')}${String(numero).padStart(9, '0')}${tipoEmissao}${codigo}`;
  let peso = 2, soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += parseInt(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return `${base}${dv}`;
}

export function resumoDRE(lancamentos) {
  let receita = 0, despesa = 0, investimento = 0;
  for (const l of lancamentos) {
    if (l.tipo === 'receita') receita += l.valor;
    else if (l.tipo === 'despesa') despesa += l.valor;
    else investimento += l.valor;
  }
  const fiscal = calcularFiscal(receita, 'mei', null, null, {});
  return {
    receita: round2(receita),
    despesa: round2(despesa),
    investimento: round2(investimento),
    impostosEstimados: fiscal.totalImpostos,
    lucroLiquido: round2(receita - despesa - investimento - fiscal.totalImpostos),
    margem: receita > 0 ? round2((receita - despesa) / receita) : 0,
  };
}
