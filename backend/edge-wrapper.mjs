// Enveloppe d'un Worker Cloudflare : redirections HTTP→HTTPS et www→apex (301) +
// en-têtes de sécurité sur toutes les réponses du Worker.
// Usage dans le point d'entrée :  export default avecEdge({ fetch(request, env, ctx) { ... } });
const APEX = "sakeurimmo.com";

const EN_TETES = {
  "Strict-Transport-Security": "max-age=15552000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function avecEdge(worker) {
  return {
    ...worker,
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const hoteGere = url.hostname === APEX || url.hostname === `www.${APEX}`;
      // Hors du domaine géré (workers.dev, localhost…) : ne rien rediriger.
      if (hoteGere && (url.protocol === "http:" || url.hostname === `www.${APEX}`)) {
        return Response.redirect(`https://${APEX}${url.pathname}${url.search}`, 301);
      }
      const reponse = await worker.fetch(request, env, ctx);
      if (!hoteGere || reponse.status === 101) return reponse; // 101 = WebSocket
      const entetes = new Headers(reponse.headers);
      for (const [nom, valeur] of Object.entries(EN_TETES)) {
        if (!entetes.has(nom)) entetes.set(nom, valeur);
      }
      return new Response(reponse.body, { status: reponse.status, statusText: reponse.statusText, headers: entetes });
    },
  };
}
