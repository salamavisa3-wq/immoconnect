// Point d'entrée Cloudflare Workers : adapte l'app Express existante (server.js,
// inchangée sinon) au runtime edge via l'adaptateur natif cloudflare:node.
// Le port n'est pas un vrai socket réseau ici, juste la clé sur laquelle
// httpServerHandler retrouve le serveur démarré par server.js.
import { httpServerHandler } from "cloudflare:node";
import "./server.js";
import { avecEnv } from "./cf-context.js";

const handler = httpServerHandler({ port: 3001 });

// avecEnv rend `env` (donc env.ASSETS) accessible depuis les handlers Express via
// cf-context.getEnv() — voir server.js pour la lecture des templates frontend/.
export default {
  fetch(request, env, ctx) {
    return avecEnv(env, () => handler.fetch(request, env, ctx));
  },
};
