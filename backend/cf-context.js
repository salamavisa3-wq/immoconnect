// cf-context.js — Fait circuler l'objet `env` de Cloudflare Workers (bindings comme
// ASSETS) jusque dans les handlers Express, qui ne le reçoivent pas nativement via
// l'adaptateur cloudflare:node (celui-ci ne connaît que app.listen(port)). En dehors
// de Workers (Node classique local/dev), getEnv() renvoie undefined.
const { AsyncLocalStorage } = require("node:async_hooks");
const als = new AsyncLocalStorage();

function avecEnv(env, fn) {
  return als.run(env, fn);
}

function getEnv() {
  return als.getStore();
}

function estSurWorkers() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

module.exports = { avecEnv, getEnv, estSurWorkers };
