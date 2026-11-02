import { test } from "node:test";
import assert from "node:assert/strict";
import { dictionaries } from "../src/i18n.ts";

test("plan card copy matches the approved Portuguese wording", () => {
  const expected = {
    tierBronzeReleases: "Novos Premium: acesso após 7 dias",
    tierPrataReleases: "Novos Premium: acesso após 5 dias",
    tierOuroReleases: "Novos Premium: prioridade nos primeiros 5 dias",
    tierReleasesTipTitle: "Acesso aos lançamentos",
    tierBronzeReleasesTip: "O Bronze pode ativar novos jogos Premium após os primeiros 7 dias do lançamento, junto com Prata e Ouro. Se houver vagas sobrando e pouca procura dos planos prioritários, a liberação poderá ser antecipada. As ativações dependem da disponibilidade.",
    tierPrataReleasesTip: "Após os primeiros 5 dias de um novo lançamento Premium, o Prata pode ativar junto com o Ouro. Nos 2 dias seguintes, o Bronze ainda aguarda sua liberação normal. O Prata pode ser liberado antes se houver vagas sobrando e baixa procura do Ouro. As ativações dependem da disponibilidade.",
    tierOuroReleasesTipTitle: "Prioridade Ouro",
    tierOuroReleasesTip: "Nos primeiros 5 dias de um novo lançamento Premium, as ativações ficam reservadas prioritariamente ao Ouro. Se houver vagas sobrando e baixa procura, outros planos podem ser liberados antecipadamente. A prioridade não garante uma vaga imediata.",
    tierOuroDownloadTab: "Acesso à aba Baixe e Jogue",
    tierOuroDownloadTabTipTitle: "O que é Baixe e Jogue?",
    tierOuroDownloadTabTip: "Uma biblioteca exclusiva do Ouro, com jogos não Steam para baixar e instalar diretamente pelo Launcher do Merlin, sem precisar de ativações Premium. Downloads estáveis, com um catálogo que continuará recebendo novos jogos.",
    tierAvailabilityTitle: "Sobre as ativações Premium",
    tierAvailabilityDescription: "Cada jogo Premium possui vagas limitadas de ativação, que voltam a ficar disponíveis conforme cada ativação completa 24 horas. A liberação para o seu plano não garante uma vaga imediata.",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(dictionaries.ptbr[key], value, key);
  }
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const key of Object.keys(expected)) {
      assert.ok(dictionary[key]?.trim(), `${locale}: ${key}`);
      if (locale !== "en") assert.notEqual(dictionary[key], dictionaries.en[key], `${locale}: ${key} must not fall back to English`);
    }
  }
});
