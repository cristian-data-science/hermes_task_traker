/*
 * Aplicar el tema guardado antes del primer paint (evita flash).
 *
 * Vive como script EXTERNO (y no inline en index.html) a propósito: la CSP
 * bloquea los scripts inline sin hash, y hashear el inline era frágil — el
 * hash cambiaba con los finales de línea del archivo (CRLF vs LF: tu PC
 * sirve CRLF, Vercel compila con LF), así que el anti-flash estuvo bloqueado
 * en silencio meses sin que se notara. Como archivo externo la CSP lo cubre
 * con 'self' y no hay nada que recalcular jamás.
 *
 * Es blocking a propósito: tiene que correr antes de que se pinte cualquier
 * cosa. Va igual de temprano en el <head> que el inline original.
 */
(function () {
  try {
    var t = localStorage.getItem("cat-theme");
    var valid = ["matrix", "terminal", "paper", "brutal"];
    document.documentElement.dataset.theme =
      valid.indexOf(t) >= 0 ? t : "matrix";
  } catch (e) {
    document.documentElement.dataset.theme = "matrix";
  }
})();
