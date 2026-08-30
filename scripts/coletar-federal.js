// Este robô visita a página-resumo de Nhamundá no Portal da Transparência
// do Governo Federal e coleta os números principais de repasses federais.
//
// A página mostra o ano atual direto, sem precisar clicar em nada - isso
// sempre é salvo. Depois, o robô tenta clicar nas abas dos outros anos
// (2022 a 2025) pra completar o histórico - se não conseguir achar essas
// abas, não tem problema: pelo menos o ano atual já fica salvo.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const URL_RESUMO = "https://portaldatransparencia.gov.br/localidades/1303007-nhamunda";
const PASTA_SAIDA = path.join(__dirname, "..", "data");

function paraNumero(valorTexto) {
  return Number(valorTexto.replace(/\./g, "").replace(",", "."));
}

async function lerValoresDaPagina(pagina) {
  return pagina.evaluate(() => {
    const texto = document.body.innerText;
    function extrair(rotulo) {
      const indice = texto.indexOf(rotulo);
      if (indice === -1) return null;
      const trecho = texto.slice(indice, indice + 250);
      const match = trecho.match(/R\$\s*([\d.]+,\d{2})/);
      return match ? match[1] : null;
    }
    return {
      transferidoAoMunicipio: extrair("Recursos transferidos apenas ao município"),
      gastosDiretos: extrair("Gastos diretos do governo federal no município"),
      beneficiosCidadao: extrair("Benefícios aos cidadãos do município"),
    };
  });
}

async function main() {
  console.log("Iniciando coleta de repasses federais para Nhamundá...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const pagina = await browser.newPage();
  await pagina.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  );
  await pagina.setViewport({ width: 1366, height: 900 });

  const resultadosPorAno = [];

  try {
    await pagina.goto(URL_RESUMO, { waitUntil: "networkidle2", timeout: 60000 });

    // Espera bem mais tempo dessa vez, e confere se o texto principal já
    // apareceu antes de seguir - portais do governo costumam ser lentos.
    let carregou = false;
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const temTexto = await pagina.evaluate(() =>
        document.body.innerText.includes("Recursos transferidos apenas ao município")
      );
      if (temTexto) {
        carregou = true;
        break;
      }
    }
    console.log(`Página carregou o conteúdo principal? ${carregou}`);

    // Sempre salva o ano padrão (o que a página mostra ao abrir), mesmo que
    // as abas de outros anos não sejam encontradas depois.
    const anoAtual = new Date().getFullYear().toString();
    const valoresAtuais = await lerValoresDaPagina(pagina);
    console.log(`Ano padrão (${anoAtual}): ${JSON.stringify(valoresAtuais)}`);

    if (valoresAtuais.transferidoAoMunicipio || valoresAtuais.gastosDiretos || valoresAtuais.beneficiosCidadao) {
      resultadosPorAno.push({
        ano: anoAtual,
        recursosTransferidosAoMunicipio: valoresAtuais.transferidoAoMunicipio ? paraNumero(valoresAtuais.transferidoAoMunicipio) : null,
        gastosDiretos: valoresAtuais.gastosDiretos ? paraNumero(valoresAtuais.gastosDiretos) : null,
        beneficiosCidadao: valoresAtuais.beneficiosCidadao ? paraNumero(valoresAtuais.beneficiosCidadao) : null,
      });
    }

    // Agora tenta achar e clicar nas abas de outros anos.
    const anos = await pagina.evaluate(() => {
      const candidatos = Array.from(document.querySelectorAll("a, button, li, span, div"));
      const anosEncontrados = candidatos
        .filter((el) => el.children.length === 0) // só elementos "folha", sem filhos
        .map((el) => el.textContent.trim())
        .filter((texto) => /^20\d{2}$/.test(texto));
      return [...new Set(anosEncontrados)];
    });

    console.log(`Abas de ano encontradas: ${anos.join(", ") || "nenhuma"}`);

    for (const ano of anos) {
      if (ano === anoAtual) continue; // já temos esse
      console.log(`\nTentando clicar no ano ${ano}...`);
      try {
        const clicou = await pagina.evaluate((anoAlvo) => {
          const elementos = Array.from(document.querySelectorAll("a, button, li, span, div"));
          const alvo = elementos.find((el) => el.children.length === 0 && el.textContent.trim() === anoAlvo);
          if (alvo) {
            alvo.click();
            return true;
          }
          return false;
        }, ano);

        if (!clicou) {
          console.log(`  Não consegui clicar no ano ${ano}.`);
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
        const valores = await lerValoresDaPagina(pagina);
        console.log(`  ${ano}: ${JSON.stringify(valores)}`);

        if (valores.transferidoAoMunicipio || valores.gastosDiretos || valores.beneficiosCidadao) {
          resultadosPorAno.push({
            ano,
            recursosTransferidosAoMunicipio: valores.transferidoAoMunicipio ? paraNumero(valores.transferidoAoMunicipio) : null,
            gastosDiretos: valores.gastosDiretos ? paraNumero(valores.gastosDiretos) : null,
            beneficiosCidadao: valores.beneficiosCidadao ? paraNumero(valores.beneficiosCidadao) : null,
          });
        }
      } catch (erro) {
        console.log(`  Erro ao processar o ano ${ano}: ${erro.message}`);
      }
    }
  } catch (erro) {
    console.error(`Erro geral: ${erro.message}`);
  } finally {
    await browser.close();
  }

  fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  const arquivoSaida = path.join(PASTA_SAIDA, "federal-resumo-nhamunda.json");

  if (resultadosPorAno.length === 0 && fs.existsSync(arquivoSaida)) {
    console.log("\nNenhum dado novo encontrado - mantendo arquivo anterior, se existir.");
  } else {
    fs.writeFileSync(arquivoSaida, JSON.stringify(resultadosPorAno, null, 2), "utf-8");
    console.log(`\nSalvo em ${arquivoSaida} (${resultadosPorAno.length} ano(s))`);
  }
}

main();
