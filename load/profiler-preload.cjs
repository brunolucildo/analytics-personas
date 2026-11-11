// Perfil de CPU da thread principal da API, sem sinais (no Windows o SIGTERM nao deixa o Node
// gravar o perfil). Carregado com `NODE_OPTIONS=--require <este arquivo>`; configurado por env:
//   PROFILE_OUT          arquivo .cpuprofile de saida (obrigatorio; sem ele nada acontece)
//   PROFILE_DELAY_MS     quanto esperar depois de subir antes de comecar (padrao 60000)
//   PROFILE_DURATION_MS  quanto tempo gravar (padrao 30000)
// Abre o resultado no Chrome DevTools (aba Performance) ou analise com a ferramenta que preferir.
const inspector = require("node:inspector");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const out = process.env.PROFILE_OUT;

if (out) {
  const delay = Number(process.env.PROFILE_DELAY_MS ?? 60000);
  const duration = Number(process.env.PROFILE_DURATION_MS ?? 30000);
  const session = new inspector.Session();

  session.connect();

  const post = (method, params) =>
    new Promise((resolve, reject) =>
      session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
    );

  setTimeout(async () => {
    try {
      await post("Profiler.enable");
      await post("Profiler.setSamplingInterval", { interval: 500 });
      await post("Profiler.start");
      console.error(`[profiler] gravando ${duration} ms em ${out}`);

      setTimeout(async () => {
        try {
          const { profile } = await post("Profiler.stop");

          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, JSON.stringify(profile));
          console.error(`[profiler] gravado: ${out}`);
        } catch (error) {
          console.error("[profiler] falhou ao gravar", error);
        }
      }, duration).unref();
    } catch (error) {
      console.error("[profiler] falhou ao iniciar", error);
    }
  }, delay).unref();
}
