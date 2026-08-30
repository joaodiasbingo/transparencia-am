// Este robô busca a página-resumo de Nhamundá no Portal da Transparência
// do Governo Federal. Diferente dos outros robôs, esse NÃO precisa de
// navegador (Puppeteer) - os números reais já vêm prontos no HTML da
// página, antes mesmo do JavaScript rodar. Um simples download da página
// já é suficiente (e mais rápido e confiável).

const fs = require("fs");
const path = require("path");

const URL_RESUMO = "https://portaldatransparencia.gov.br/localidades/1303007-nhamunda";
const PASTA_SAIDA = path.join(__dirname, "..", "data");

function paraNumero(valorTexto) {
  return Number(valorTexto.replace(/\./g, "").replace(",", "."));
}

function extrairValor(texto, rotulo) {
  const indice = texto.indexOf(rotulo);
  if (indice === -1) return null;
  // Janela bem mais curta - só o suficiente pra pegar o número logo depois
  // do rótulo, sem vazar pro campo seguinte da página.
  const trecho = texto.slice(indice, indice + 150);
  const match = trecho.match(/R\$\s*([\d.]+,\d{2})/);
  return match ? match[1] : null;
}

async function main() {
  console.log("Iniciando coleta de repasses federais para Nhamundá...");

  const resposta = await fetch(URL_RESUMO, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!resposta.ok) {
    throw new Error(`Falha ao baixar a página (status ${resposta.status})`);
  }

  const html = await resposta.text();

  // Remove as tags HTML para sobrar só o texto (parecido com o que o
  // navegador mostraria), pra facilitar achar os valores.
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const valores = {
    transferidoAoMunicipio: extrairValor(texto, "Recursos transferidos apenas ao munic"),
    gastosDiretos: extrairValor(texto, "Gastos diretos do governo federal no munic"),
    beneficiosCidadao: extrairValor(texto, "Benefícios aos cidadãos do munic"),
  };

  console.log(`Valores encontrados: ${JSON.stringify(valores)}`);

  const anoAtual = new Date().getFullYear().toString();
  const resultadosPorAno = [];

  if (valores.transferidoAoMunicipio || valores.gastosDiretos || valores.beneficiosCidadao) {
    resultadosPorAno.push({
      ano: anoAtual,
      recursosTransferidosAoMunicipio: valores.transferidoAoMunicipio ? paraNumero(valores.transferidoAoMunicipio) : null,
      gastosDiretos: valores.gastosDiretos ? paraNumero(valores.gastosDiretos) : null,
      beneficiosCidadao: valores.beneficiosCidadao ? paraNumero(valores.beneficiosCidadao) : null,
    });
  }

  console.log(
    "Observação: essa página só mostra o ano atual sem precisar de navegador. " +
      "Anos anteriores (2022-2025) ficam escondidos atrás de abas que só funcionam com JavaScript " +
      "e ainda não conseguimos ler de forma automática."
  );

  fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  const arquivoSaida = path.join(PASTA_SAIDA, "federal-resumo-nhamunda.json");

  if (resultadosPorAno.length === 0 && fs.existsSync(arquivoSaida)) {
    console.log("\nNenhum dado novo encontrado - mantendo arquivo anterior, se existir.");
  } else {
    fs.writeFileSync(arquivoSaida, JSON.stringify(resultadosPorAno, null, 2), "utf-8");
    console.log(`\nSalvo em ${arquivoSaida} (${resultadosPorAno.length} ano(s))`);
  }
}

main().catch((erro) => {
  console.error(`Erro geral: ${erro.message}`);
  process.exit(1);
});
