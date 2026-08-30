// Este robô visita a página-resumo de Nhamundá no Portal da Transparência
// do Governo Federal e coleta os números principais de repasses federais,
// clicando em cada aba de ano disponível (a página não permite acessar o
// ano direto pelo endereço - precisa clicar mesmo).

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const URL_RESUMO = "https://portaldatransparencia.gov.br/localidades/1303007-nhamunda";
const PASTA_SAIDA = path.join(__dirname, "..", "data");

function paraNumero(valorTexto) {
  return Number(valorTexto.replace(/\./g, "").replace(",", "."));
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

  const resultadosPorAno = [];

  try {
    await pagina.goto(URL_RESUMO, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Descobre quais anos aparecem como abas clicáveis no topo da página.
    const anos = await pagina.evaluate(() => {
      const candidatos = Array.from(document.querySelectorAll("a, button, li, span"));
      const anosEncontrados = candidatos
        .map((el) => el.textContent.trim())
        .filter((texto) => /^20\d{2}$/.test(texto));
      return [...new Set(anosEncontrados)];
    });

    console.log(`Anos encontrados na página: ${anos.join(", ") || "nenhum"}`);

    for (const ano of anos) {
      console.log(`\nClicando no ano ${ano}...`);
      try {
        const clicou = await pagina.evaluate((anoAlvo) => {
          const elementos = Array.from(document.querySelectorAll("a, button, li, span"));
          const alvo = elementos.find((el) => el.textContent.trim() === anoAlvo);
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

        await new Promise((resolve) => setTimeout(resolve, 2500));

        const valores = await pagina.evaluate(() => {
          const texto = document.body.innerText;
          function extrair(rotulo) {
            const indice = texto.indexOf(rotulo);
            if (indice === -1) return null;
            const trecho = texto.slice(indice, indice + 200);
            const match = trecho.match(/R\$\s*([\d.]+,\d{2})/);
            return match ? match[1] : null;
          }
          return {
            transferidoAoMunicipio: extrair("Recursos transferidos apenas ao município"),
            gastosDiretos: extrair("Gastos diretos do governo federal no município"),
            beneficiosCidadao: extrair("Benefícios aos cidadãos do município"),
          };
        });

        resultadosPorAno.push({
          ano,
          recursosTransferidosAoMunicipio: valores.transferidoAoMunicipio ? paraNumero(valores.transferidoAoMunicipio) : null,
          gastosDiretos: valores.gastosDiretos ? paraNumero(valores.gastosDiretos) : null,
          beneficiosCidadao: valores.beneficiosCidadao ? paraNumero(valores.beneficiosCidadao) : null,
        });

        console.log(`  ${ano}: transferido ao município = ${valores.transferidoAoMunicipio}`);
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
    console.log(`\nSalvo em ${arquivoSaida}`);
  }
}

main();
