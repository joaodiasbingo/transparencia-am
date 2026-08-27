// Este robô coleta dados de DUAS áreas do Portal da Transparência de
// Nhamundá: Despesas e Receitas. Para cada área, ele faz o mesmo trabalho
// em duas etapas:
//
// ETAPA 1 - descobrir os relatórios: visita cada página e lê a tabela de
// publicações (mês a mês).
//
// ETAPA 2 - abrir cada anexo: clica no anexo de cada relatório, captura o
// link do arquivo (PDF ou TXT), baixa e soma os valores em reais.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const pdfParse = require("pdf-parse");

const URL_BASE = "https://transparencia.diretoriodigital.inf.br/transparencia/pm-nhamunda";

// Cada "área" tem seu próprio segmento de URL e sua própria lista de
// subcategorias descobertas manualmente no portal.
const AREAS = [
  {
    segmento: "despesas",
    subcategorias: [
      { id: 1461, nome: "listagem-de-despesas" },
      { id: 1462, nome: "balancete-de-despesas" },
      { id: 1463, nome: "despesas-pagas" },
      { id: 3413, nome: "despesas-royalties" },
    ],
  },
  {
    segmento: "receitas",
    subcategorias: [
      { id: 1464, nome: "listagem-de-receitas" },
      { id: 1465, nome: "balancete-de-receitas" },
      { id: 2142, nome: "divida-ativa" },
      { id: 3412, nome: "receitas-royalties" },
    ],
  },
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

async function abrirAnexoDaLinha(pagina, indiceLinha, descricaoEsperada) {
  await pagina.keyboard.press("Escape").catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  await pagina.evaluate(() => {
    document.querySelectorAll("a[href$='.pdf']").forEach((el) => el.remove());
  });

  const linhas = await pagina.$$("#tbl-padrao tbody tr");
  const linha = linhas[indiceLinha];
  if (!linha) return null;

  const celulas = await linha.$$("td");
  const celulaAnexo = celulas[celulas.length - 1];
  if (!celulaAnexo) return null;

  const clicavel = await celulaAnexo.$("a, button, span");
  if (!clicavel) return null;

  const browser = pagina.browser();
  const paginasAntes = await browser.pages();

  await clicavel.click().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const paginasDepois = await browser.pages();
  let linkArquivo = null;

  if (paginasDepois.length > paginasAntes.length) {
    const novaAba = paginasDepois[paginasDepois.length - 1];
    linkArquivo = novaAba.url();
    await novaAba.close().catch(() => {});
  } else {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const resultado = await pagina.evaluate((descricaoEsperada) => {
        const link = document.querySelector("a[href$='.pdf']");
        if (!link) return { encontrado: false };
        const textoModal = document.body.innerText || "";
        const bateComALinha = descricaoEsperada
          ? textoModal.includes(descricaoEsperada)
          : true;
        return { encontrado: true, href: link.href, bateComALinha };
      }, descricaoEsperada);

      if (resultado.encontrado && resultado.bateComALinha) {
        linkArquivo = resultado.href;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await pagina.keyboard.press("Escape").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return linkArquivo;
}

// Reconhece linhas de valores de verdade dentro dos relatórios. Cada tipo
// de relatório tem um formato de colunas diferente, então o robô tenta
// cada padrão conhecido e usa o que encontrar mais linhas.
const PADROES_LINHA = [
  {
    // Despesas Liquidadas: numero data valor_liquidado valor_anulado descontos saldo ...
    nome: "despesas_liquidadas",
    regex: /^\d+\s+\d{2}\/\d{2}\/\d{4}\s+([\d.]+,\d{2})\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}/,
  },
  {
    // Despesas Empenhadas: empenho tipo data empenhado anulado liquidado pago retido liquido a_pagar ...
    nome: "despesas_empenhadas",
    regex: /^\d+\s+[A-Z]{1,3}\s+\d{2}\/\d{2}\/\d{4}\s+([\d.]+,\d{2})\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}/,
  },
];

function extrairValoresDeLinhasEstruturadas(texto) {
  let melhor = { nome: null, valores: [] };
  for (const padrao of PADROES_LINHA) {
    const valores = [];
    for (const linha of texto.split(/\r?\n/)) {
      const encontrado = linha.trim().match(padrao.regex);
      if (encontrado) valores.push(paraNumero(encontrado[1]));
    }
    if (valores.length > melhor.valores.length) {
      melhor = { nome: padrao.nome, valores };
    }
  }
  return melhor;
}

async function baixarESomarValores(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Falha ao baixar (status ${resposta.status})`);

  let texto;
  if (url.toLowerCase().endsWith(".pdf")) {
    const buffer = Buffer.from(await resposta.arrayBuffer());
    const dados = await pdfParse(buffer);
    texto = dados.text;
  } else {
    texto = await resposta.text();
  }

  const resultado = extrairValoresDeLinhasEstruturadas(texto);

  if (resultado.valores.length > 0) {
    return {
      metodo: resultado.nome,
      quantidadeDeValoresEncontrados: resultado.valores.length,
      somaAproximada: Number(
        resultado.valores.reduce((soma, n) => soma + n, 0).toFixed(2)
      ),
    };
  }

  const valores = (texto.match(REGEX_VALOR) || []).map(paraNumero);
  return {
    metodo: "aproximado_generico",
    quantidadeDeValoresEncontrados: valores.length,
    somaAproximada: Number(valores.reduce((soma, n) => soma + n, 0).toFixed(2)),
  };
}

async function main() {
  console.log("Iniciando coleta detalhada (Despesas e Receitas)...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  fs.mkdirSync(PASTA_SAIDA, { recursive: true });

  for (const area of AREAS) {
    for (const subcategoria of area.subcategorias) {
      const url = `${URL_BASE}/${area.segmento}/subcategoria/${subcategoria.id}`;
      console.log(`\nColetando [${area.segmento}]: ${subcategoria.nome} (${url})`);

      const aba = await browser.newPage();
      let registros = [];

      try {
        registros = await coletarTabela(aba, url);
        console.log(`  -> ${registros.length} relatório(s) encontrado(s) na tabela`);

        const LIMITE_ANEXOS_POR_EXECUCAO = 20;
        const registrosParaAbrir = registros.slice(0, LIMITE_ANEXOS_POR_EXECUCAO);

        for (const registro of registrosParaAbrir) {
          try {
            const linkArquivo = await abrirAnexoDaLinha(aba, registro._linhaIndice, registro["Descrição"]);
            if (linkArquivo) {
              registro.linkAnexo = linkArquivo;
              const resumo = await baixarESomarValores(linkArquivo);
              registro.somaAproximada = resumo.somaAproximada;
              registro.quantidadeDeValoresEncontrados = resumo.quantidadeDeValoresEncontrados;
              registro.metodoDeCalculo = resumo.metodo;
              console.log(`    Anexo lido: ${linkArquivo} (soma: ${resumo.somaAproximada}, método: ${resumo.metodo})`);
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

      const arquivoSaida = path.join(PASTA_SAIDA, `${area.segmento}-${subcategoria.nome}.json`);
      fs.writeFileSync(arquivoSaida, JSON.stringify(registros, null, 2), "utf-8");
      console.log(`  Salvo em ${arquivoSaida}`);
    }
  }

  await browser.close();
  console.log("\nColeta concluída.");
}

main();
