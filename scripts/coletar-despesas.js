// Este robô faz o trabalho em DUAS ETAPAS:
//
// ETAPA 1 - descobrir os relatórios: visita cada página de despesas do
// portal e lê a tabela de publicações (mês a mês), igual já fazíamos.
//
// ETAPA 2 - abrir cada anexo: para cada relatório encontrado, clica no
// anexo (o link "+1" na tabela) e captura o endereço do PDF de dentro
// dele. Depois baixa esse PDF e soma os valores em reais que aparecem
// no texto, para termos um total por relatório.
//
// Isso é mais lento (visita centenas de relatórios), então o robô
// mostra o progresso no log conforme avança.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const pdfParse = require("pdf-parse");

const URL_BASE = "https://transparencia.diretoriodigital.inf.br/transparencia/pm-nhamunda/despesas/subcategoria";

const SUBCATEGORIAS = [
  { id: 1461, nome: "listagem-de-despesas" },
  { id: 1462, nome: "balancete-de-despesas" },
  { id: 1463, nome: "despesas-pagas" },
  { id: 3413, nome: "despesas-royalties" },
];

const PASTA_SAIDA = path.join(__dirname, "..", "data");
const REGEX_VALOR = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function paraNumero(valorTexto) {
  return Number(valorTexto.replace(/\./g, "").replace(",", "."));
}

async function coletarTabela(pagina, url) {
  await pagina.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  try {
    await pagina.waitForSelector("#tbl-padrao tbody tr", { timeout: 15000 });
  } catch {
    console.log("  Nenhuma linha apareceu na tabela dentro do tempo esperado.");
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return pagina.evaluate(() => {
    const tabela = document.querySelector("#tbl-padrao");
    if (!tabela) return [];
    const cabecalhos = Array.from(tabela.querySelectorAll("thead th")).map((th) =>
      th.textContent.trim()
    );
    return Array.from(tabela.querySelectorAll("tbody tr")).map((tr, indiceLinha) => {
      const celulas = Array.from(tr.querySelectorAll("td"));
      const registro = { _linhaIndice: indiceLinha };
      cabecalhos.forEach((cabecalho, i) => {
        registro[cabecalho || `coluna_${i}`] = celulas[i] ? celulas[i].textContent.trim() : "";
      });
      return registro;
    });
  });
}

// Tenta clicar no anexo de uma linha específica da tabela (pela posição)
// e capturar o link do PDF que aparecer (seja em nova aba, seja num modal).
async function abrirAnexoDaLinha(pagina, indiceLinha) {
  const linhas = await pagina.$$("#tbl-padrao tbody tr");
  const linha = linhas[indiceLinha];
  if (!linha) return null;

  // Procura qualquer elemento clicável na última célula (coluna Anexos).
  const celulas = await linha.$$("td");
  const celulaAnexo = celulas[celulas.length - 1];
  if (!celulaAnexo) return null;

  const clicavel = await celulaAnexo.$("a, button, span");
  if (!clicavel) return null;

  // Prepara para capturar uma aba nova, caso o clique abra uma.
  const browser = pagina.browser();
  const paginasAntes = await browser.pages();

  await clicavel.click().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const paginasDepois = await browser.pages();
  let linkPdf = null;

  if (paginasDepois.length > paginasAntes.length) {
    // Abriu uma aba nova - o link do PDF deve ser a própria URL dela.
    const novaAba = paginasDepois[paginasDepois.length - 1];
    linkPdf = novaAba.url();
    await novaAba.close().catch(() => {});
  } else {
    // Não abriu aba nova - procura um link de PDF que tenha aparecido na mesma página (modal).
    linkPdf = await pagina.evaluate(() => {
      const link = document.querySelector("a[href$='.pdf']");
      return link ? link.href : null;
    });
    // Fecha modal se houver (tecla Esc costuma funcionar nesses portais).
    await pagina.keyboard.press("Escape").catch(() => {});
  }

  return linkPdf;
}

async function baixarESomarPdf(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Falha ao baixar (status ${resposta.status})`);
  const buffer = Buffer.from(await resposta.arrayBuffer());
  const dados = await pdfParse(buffer);
  const valores = (dados.text.match(REGEX_VALOR) || []).map(paraNumero);
  return {
    quantidadeDeValoresEncontrados: valores.length,
    somaAproximada: Number(valores.reduce((soma, n) => soma + n, 0).toFixed(2)),
  };
}

async function main() {
  console.log("Iniciando coleta detalhada de despesas (com anexos)...");

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
      console.log(`  -> ${registros.length} relatório(s) encontrado(s) na tabela`);

      // Limita a quantidade de anexos abertos por execução, para não
      // demorar demais nem sobrecarregar o portal. Pega os mais recentes
      // primeiro (assume-se que a tabela já vem ordenada do mais novo pro
      // mais antigo, como vimos no teste manual).
      const LIMITE_ANEXOS_POR_EXECUCAO = 20;
      const registrosParaAbrir = registros.slice(0, LIMITE_ANEXOS_POR_EXECUCAO);

      for (const registro of registrosParaAbrir) {
        try {
          const linkPdf = await abrirAnexoDaLinha(aba, registro._linhaIndice);
          if (linkPdf) {
            registro.linkAnexo = linkPdf;
            const resumo = await baixarESomarPdf(linkPdf);
            registro.somaAproximada = resumo.somaAproximada;
            registro.quantidadeDeValoresEncontrados = resumo.quantidadeDeValoresEncontrados;
            console.log(`    Anexo lido: ${linkPdf} (soma aprox: ${resumo.somaAproximada})`);
          } else {
            console.log(`    Linha ${registro._linhaIndice}: não encontrei link de anexo.`);
          }
        } catch (erro) {
          console.log(`    Linha ${registro._linhaIndice}: erro ao abrir anexo (${erro.message})`);
        }
      }
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
  console.log("\nColeta concluída.");
}

main();
