// Este script abre o Portal da Transparencia de Nhamunda como se fosse
// uma pessoa navegando (usando um navegador automatizado chamado Puppeteer),
// entra na secao de Despesas e salva os links de todos os PDFs que encontrar
// em data/relatorios-despesas.json.
//
// Como o portal e feito em JavaScript (o conteudo so aparece depois que a
// pagina "roda" no navegador), nao da pra simplesmente ler o endereco de
// fora - por isso precisamos desse navegador automatizado.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const URL_BASE = "https://transparencia.diretoriodigital.inf.br/client-page/pm-nhamunda";

// Paginas conhecidas onde relatorios de despesas costumam aparecer.
// Se o portal usar nomes diferentes, ajustamos essa lista depois de ver
// o resultado da primeira execucao.
const PAGINAS_DESPESAS = [
  "/despesas/despesas_pagas",
  "/despesas/listagem-despesas",
  "/planejamento-contas/balanco_anual",
];

const ARQUIVO_SAIDA = path.join(__dirname, "..", "data", "relatorios-despesas.json");

async function coletarLinksDaPagina(pagina, url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const links = [];

  try {
    const aba = await browser.newPage();
    await aba.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Da um tempo extra para o conteudo dinamico terminar de carregar.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Pega todos os links (<a href="...">) que apontam para um arquivo PDF.
    const pdfsEncontrados = await aba.$$eval("a[href$='.pdf']", (elementos) =>
      elementos.map((el) => ({
        url: el.href,
        texto: el.textContent.trim(),
      }))
    );

    links.push(...pdfsEncontrados);
  } catch (erro) {
    console.error(`Nao foi possivel abrir ${url}: ${erro.message}`);
  } finally {
    await browser.close();
  }

  return links;
}

function extrairAnoMesTipo(url) {
  // As URLs dos PDFs seguem o padrao:
  // .../pm-nhamunda/{ano}/{mes}/despesas/{tipo}/arquivo.pdf
  const match = url.match(/pm-nhamunda\/(\d{4})\/(\d{2})\/([^/]+)\/([^/]+)\//);
  if (!match) return null;
  const [, ano, mes, categoria, tipo] = match;
  return { ano, mes, categoria, tipo };
}

async function main() {
  console.log("Iniciando busca de relatorios de despesas...");

  const todosOsLinks = [];

  for (const pagina of PAGINAS_DESPESAS) {
    const url = URL_BASE + pagina;
    console.log(`Verificando: ${url}`);
    const links = await coletarLinksDaPagina(pagina, url);
    console.log(`  -> ${links.length} PDF(s) encontrado(s)`);
    todosOsLinks.push(...links);
  }

  // Remove duplicados (mesma URL encontrada em mais de uma pagina).
  const vistos = new Set();
  const relatorios = [];
  for (const item of todosOsLinks) {
    if (vistos.has(item.url)) continue;
    vistos.add(item.url);
    const info = extrairAnoMesTipo(item.url);
    relatorios.push({
      url: item.url,
      texto: item.texto,
      ano: info ? info.ano : null,
      mes: info ? info.mes : null,
      tipo: info ? info.tipo : null,
    });
  }

  fs.mkdirSync(path.dirname(ARQUIVO_SAIDA), { recursive: true });
  fs.writeFileSync(ARQUIVO_SAIDA, JSON.stringify(relatorios, null, 2), "utf-8");

  console.log(`\nConcluido: ${relatorios.length} relatorio(s) unico(s) salvo(s) em ${ARQUIVO_SAIDA}`);

  if (relatorios.length === 0) {
    console.log(
      "\nATENCAO: nenhum PDF foi encontrado. Isso pode significar que o portal " +
      "mudou de endereco ou de estrutura. Sera preciso ajustar a lista PAGINAS_DESPESAS " +
      "neste arquivo depois de conferir o portal manualmente."
    );
  }
}

main();
