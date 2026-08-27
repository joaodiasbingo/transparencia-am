// Este script abre cada página de despesas do Portal da Transparência de
// Nhamundá (usando um navegador automatizado, o Puppeteer) e le a TABELA de
// dados diretamente da página - sem precisar baixar nem interpretar PDF.
// E mais confiavel do que a versao anterior porque os dados ja vem
// organizados em colunas pelo proprio portal.
//
// Para adicionar um novo tipo de despesa (Empenhos, Liquidacoes, Pagamentos
// etc.), basta acrescentar um novo item na lista SUBCATEGORIAS abaixo, com
// o numero encontrado no endereco da pagina correspondente.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const URL_BASE = "https://transparencia.diretoriodigital.inf.br/transparencia/pm-nhamunda/despesas/subcategoria";

const SUBCATEGORIAS = [
  { id: 1461, nome: "listagem-de-despesas" },
  { id: 1462, nome: "balancete-de-despesas" },
  { id: 1463, nome: "despesas-pagas" },
  { id: 3413, nome: "despesas-royalties" },
];

const PASTA_SAIDA = path.join(__dirname, "..", "data");

async function coletarTabela(pagina, url) {
  await pagina.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // Da um tempo para a tabela carregar os dados via JavaScript.
  try {
    await pagina.waitForSelector("#tbl-padrao tbody tr", { timeout: 15000 });
  } catch {
    console.log("  Nenhuma linha apareceu na tabela dentro do tempo esperado.");
  }

  // Espera extra de seguranca, caso os dados ainda estejam carregando aos poucos.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const dados = await pagina.evaluate(() => {
    const tabela = document.querySelector("#tbl-padrao");
    if (!tabela) return { cabecalhos: [], linhas: [] };

    const cabecalhos = Array.from(tabela.querySelectorAll("thead th")).map(
      (th) => th.textContent.trim()
    );

    const linhas = Array.from(tabela.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim())
    );

    return { cabecalhos, linhas };
  });

  // Transforma cada linha da tabela em um objeto (coluna -> valor),
  // usando os cabecalhos como nome de cada campo.
  const registros = dados.linhas.map((linha) => {
    const registro = {};
    dados.cabecalhos.forEach((cabecalho, indice) => {
      registro[cabecalho || `coluna_${indice}`] = linha[indice] || "";
    });
    return registro;
  });

  return registros;
}

async function main() {
  console.log("Iniciando coleta de dados de despesas...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  fs.mkdirSync(PASTA_SAIDA, { recursive: true });

  for (const subcategoria of SUBCATEGORIAS) {
    const url = `${URL_BASE}/${subcategoria.id}`;
    console.log(`\nColetando: ${subcategoria.nome} (${url})`);

    const aba = await browser.newPage();
    let registros = [];

    try {
      registros = await coletarTabela(aba, url);
      console.log(`  -> ${registros.length} registro(s) encontrado(s)`);
    } catch (erro) {
      console.error(`  Erro ao coletar ${subcategoria.nome}: ${erro.message}`);
    } finally {
      await aba.close();
    }

    const arquivoSaida = path.join(PASTA_SAIDA, `despesas-${subcategoria.nome}.json`);
    fs.writeFileSync(arquivoSaida, JSON.stringify(registros, null, 2), "utf-8");
    console.log(`  Salvo em ${arquivoSaida}`);
  }

  await browser.close();
  console.log("\nColeta concluida.");
}

main();
