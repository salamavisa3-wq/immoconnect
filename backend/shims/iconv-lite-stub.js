// iconv-lite-stub.js — remplace iconv-lite sous Cloudflare Workers (voir wrangler.jsonc
// "alias" + le commentaire dans server.js sur jsonWorkersSafe). Le vrai iconv-lite plante
// au chargement du bundle Workers : son lib/index.js exécute `require("./streams")`
// inconditionnellement dès que `process.versions.node` existe (vrai sous nodejs_compat),
// mais le remap "browser" du package.json d'iconv-lite (appliqué par l'esbuild de Wrangler)
// stub ce require à `false` → appelé comme fonction → "require_streams(...) is not a
// function". Express charge `bodyParser.json` (donc iconv-lite, via raw-body) dès
// `require("express")`, avant même tout code applicatif : impossible à éviter en amont,
// il faut remplacer le module entier.
//
// raw-body (seul consommateur ici, via body-parser → express.json()) n'utilise que
// `getDecoder(encoding)` pour décoder le corps d'une requête en flux. Cette API ne traite
// que du JSON en UTF-8 : un décodeur UTF-8 minimal (Node "string_decoder", déjà correct
// pour les caractères multi-octets coupés entre deux chunks) suffit. Tout autre charset
// lève la même erreur "Encoding not recognized" que le vrai iconv-lite, que raw-body
// traduit en 415 — comportement inchangé pour ce cas (rare pour une API JSON).
const { StringDecoder } = require("string_decoder");

function estUtf8(encoding) {
  return /^utf-?8$/i.test(String(encoding || ""));
}

exports.encodingExists = estUtf8;

exports.getDecoder = function getDecoder(encoding) {
  if (!estUtf8(encoding)) {
    throw new Error("Encoding not recognized: " + encoding);
  }
  const decodeur = new StringDecoder("utf8");
  return {
    write(buf) {
      return decodeur.write(buf);
    },
    end(buf) {
      return decodeur.end(buf);
    },
  };
};

exports.decode = function decode(buf, encoding) {
  if (!estUtf8(encoding)) {
    throw new Error("Encoding not recognized: " + encoding);
  }
  return Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
};

exports.encode = function encode(str) {
  return Buffer.from(String(str), "utf8");
};
