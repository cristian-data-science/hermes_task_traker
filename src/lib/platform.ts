/**
 * Detección de plataforma para gates de UI.
 *
 * El APK Android es un TWA (Trusted Web Activity generado con PWABuilder,
 * package `app.vercel.agenttask_one`) que carga esta misma web. Chrome lanza
 * un TWA con `document.referrer = "android-app://<paquete>"` — una señal que
 * ningún navegador normal manda. Con eso distinguimos "estás en el APK" de
 * "estás en la web" sin builds separados ni query params.
 *
 * Se evalúa UNA vez al cargar el módulo: el referrer del launch es fijo
 * durante toda la vida de la SPA (no hay navegaciones plenas).
 *
 * Ojo: matchea cualquier `android-app://` a propósito, no solo el package
 * actual — si el APK se regenera con otro package (generador reproducible),
 * el gate sigue funcionando.
 */
export const ANDROID_TWA =
  typeof document !== "undefined" &&
  document.referrer.startsWith("android-app://");
