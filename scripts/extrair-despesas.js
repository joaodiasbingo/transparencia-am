// Este script le o arquivo data/relatorios-despesas.json (gerado pelo
// buscar-relatorios.js), baixa cada PDF listado, e extrai os valores em
// reais que aparecem nas tabelas, somando o total de cada relatorio.
//
// Extracao linha a linha de tabelas dentro de PDF nunca e 100% perfeita
// (o formato varia entre "empenhos", "liquidacoes" e "pagamentos"), entao
// este script comeca pela versao mais simples e confiavel: encontrar todos
// os valores em formato de dinheiro (ex: 12.345,67) e somar. Isso ja da um
// total por mes/tipo de relatorio, que e o dado mais util para o site.

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const ARQUIVO_ENTRADA = path.join(__dirname, "..", "data", "relatorios-despesas.json");
const ARQUIVO_SAIDA = path.join(__dirname, "..", "data", "despesas-extraidas.json");

// Reconhece valores como 12.345,67 ou 1.234.567,89
const REGEX_VALOR = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function paraNumero(valorTexto) {
  return Number(valorTexto.replace(/\./g, "").replace(",", "."));
}

async function baixarPdf(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(`Falha ao baixar (status ${resposta.status})`);
  }
  const buffer = await resposta.arrayBuffer();
  return Buffer.from(buffer);
}

async function processarRelatorio(relatorio) {
  console.log(`Processando: ${relatorio.url}`);

  const pdfBuffer = await baixarPdf(relatorio.url);
  const dados = await pdfParse(pdfBuffer);
  const texto = dados.text;

  const valoresEncontrados = texto.match(REGEX_VALOR) || [];
  const numeros = valoresEncontrados.map(paraNumero);

  // Heuristica simples: o maior valor encontrado no documento costuma ser
  // o total geral (linhas de "Total:" no fim do relatorio). Os demais
  // valores somados servem como conferencia aproximada.
  const somaTodosOsValores = numeros.reduce((soma, n) => soma + n, 0);
  const maiorValor = numeros.length ? Math.max(...numeros) : 0;

  return {
    ano: relatorio.ano,
    mes: relatorio.mes,
    tipo: relatorio.tipo,
    url: relatorio.url,
    quantidadeDeValoresEncontrados: numeros.length,
    somaAproximada: Number(somaTodosOsValores.toFixed(2)),
    maiorValorEncontrado: Number(maiorValor.toFixed(2)),
  };
}

async function main() {
  if (!fs.existsSync(ARQUIVO_ENTRADA)) {
    console.error(
      `Arquivo ${ARQUIVO_ENTRADA} nao encontrado. Rode "npm run buscar" primeiro.`
    );
    process.exit(1);
  }

  const relatorios = JSON.parse(fs.readFileSync(ARQUIVO_ENTRADA, "utf-8"));
  console.log(`Encontrados ${relatorios.length} relatorio(s) para processar.\n`);

  const resultados = [];
  for (const relatorio of relatorios) {
    try {
      const resultado = await processarRelatorio(relatorio);
      resultados.push(resultado);
    } catch (erro) {
      console.error(`  Erro ao processar ${relatorio.url}: ${erro.message}`);
      resultados.push({
        ano: relatorio.ano,
        mes: relatorio.mes,
        tipo: relatorio.tipo,
        url: relatorio.url,
        erro: erro.message,
      });
    }
  }

  fs.mkdirSync(path.dirname(ARQUIVO_SAIDA), { recursive: true });
  fs.writeFileSync(ARQUIVO_SAIDA, JSON.stringify(resultados, null, 2), "utf-8");

  console.log(`\nConcluido. Dados extraidos salvos em ${ARQUIVO_SAIDA}`);
}

main();
