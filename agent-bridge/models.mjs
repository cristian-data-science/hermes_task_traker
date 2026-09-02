/**
 * Catálogo de modelos de la instalación local de ZCode + swap por corrida.
 *
 * Fuente del catálogo: resources/model-providers/models_catalog_*.json
 * (provider activo, p.ej. zai-coding-plan) + el default del config de
 * usuario. Se sincroniza a Convex (settings agent.models): si aparece un
 * modelo nuevo en una actualización de ZCode, aparece solo en el picker.
 *
 * Swap verificado empíricamente (31-ago-2026): escribir el `model` del config
 * de usuario con id "<providerKey>/<modelId>" cambia el modelo de la corrida
 * headless (ids del catálogo funcionan verbatim, mayúscula o minúscula).
 */
import fs from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import {
  ZCODE_CONFIG,
  ZCODE_DESKTOP_CONFIG,
  ZCODE_MODEL_PROVIDERS_DIR,
  MODEL_BACKUP,
} from "./config.mjs";

/** Lee el config de usuario del CLI (model default + provider activo). */
export function readZcodeConfig() {
  return JSON.parse(fs.readFileSync(ZCODE_CONFIG, "utf8"));
}

/**
 * Lista [{id, label}] de modelos del provider activo.
 *
 * Fuente primaria: el config del DESKTOP (~/.zcode/v2/config.json) — su
 * provider[<providerKey>].models es la lista viva y con entitlements del plan
 * (GLM-5.3, GLM-5.3-Flash, GLM-5-Turbo). Fallback: el catálogo estático de
 * resources/model-providers (puede quedar añejo: fue el caso de 5.3-Flash).
 * id = "<providerKey>/<modelId>" (formato del config; el CLI lo acepta
 * verbatim — probado con GLM-5.3, glm-5.3 y GLM-5.3-Flash).
 */
export function readModelCatalog() {
  const cfg = readZcodeConfig();
  const defaultModel = typeof cfg.model === "string" ? cfg.model : "";
  // "builtin:zai-coding-plan/GLM-5.2" → "builtin:zai-coding-plan"
  const providerKey = defaultModel.includes("/")
    ? defaultModel.slice(0, defaultModel.lastIndexOf("/"))
    : "";
  if (!providerKey) return { models: [], default: defaultModel, providerKey };

  // 1) Config del desktop: fuente fresca y con entitlements.
  const models = [];
  try {
    const v2 = JSON.parse(fs.readFileSync(ZCODE_DESKTOP_CONFIG, "utf8"));
    const provModels = v2?.provider?.[providerKey]?.models;
    for (const id of Object.keys(provModels ?? {})) {
      models.push({ id: `${providerKey}/${id}`, label: provModels[id]?.name || id });
    }
  } catch {
    // sin desktop config → catálogo estático
  }
  if (models.length) return { models, default: defaultModel, providerKey };

  // 2) Fallback: catálogo estático (el provider se llama sin el prefijo "builtin:").
  const catalogId = providerKey.replace(/^builtin:/, "");
  if (existsSync(ZCODE_MODEL_PROVIDERS_DIR)) {
    for (const f of readdirSync(ZCODE_MODEL_PROVIDERS_DIR)) {
      if (!f.endsWith(".json")) continue;
      let cat;
      try {
        cat = JSON.parse(fs.readFileSync(`${ZCODE_MODEL_PROVIDERS_DIR}/${f}`, "utf8"));
      } catch {
        continue;
      }
      const provider = (cat.providers || []).find((p) => p.id === catalogId);
      if (!provider) continue;
      for (const mod of provider.models || []) {
        models.push({
          id: `${providerKey}/${mod.id}`,
          label: mod.name || mod.id,
        });
      }
      break;
    }
  }
  return { models, default: defaultModel, providerKey };
}

/**
 * Swap temporal del modelo para UNA corrida: backup del config → setea el
 * modelo elegido (agregándolo al map de modelos del provider si no está) →
 * devuelve la función de restauración.
 *
 * El dispatcher corre una tarea por vez: no hay swaps concurrentes. Si el
 * proceso muere antes de restaurar, el dispatcher al arrancar restaura desde
 * .model-backup.json.
 */
export function swapModel(modelId) {
  const original = fs.readFileSync(ZCODE_CONFIG, "utf8");
  fs.writeFileSync(MODEL_BACKUP, original);

  if (modelId && modelId.includes("/")) {
    const cfg = JSON.parse(original);
    cfg.model = modelId;
    const key = modelId.slice(0, modelId.lastIndexOf("/"));
    const short = modelId.slice(modelId.lastIndexOf("/") + 1);
    if (cfg.provider && cfg.provider[key]) {
      const prov = cfg.provider[key];
      prov.models = prov.models || {};
      if (!prov.models[short]) {
        prov.models[short] = {
          limit: { context: 1000000 },
          modalities: { input: ["text"], output: ["text"] },
        };
      }
    }
    fs.writeFileSync(ZCODE_CONFIG, JSON.stringify(cfg, null, 2));
  }

  let restored = false;
  return function restore() {
    if (restored) return;
    restored = true;
    try {
      fs.writeFileSync(ZCODE_CONFIG, original);
      fs.unlinkSync(MODEL_BACKUP);
    } catch {
      // best-effort: el arranque del dispatcher reintenta desde el backup
    }
  };
}

/** Restaura un swap huérfano de una corrida anterior que crasheó. */
export function restoreOrphanSwap() {
  try {
    if (!existsSync(MODEL_BACKUP)) return false;
    fs.writeFileSync(ZCODE_CONFIG, fs.readFileSync(MODEL_BACKUP, "utf8"));
    fs.unlinkSync(MODEL_BACKUP);
    return true;
  } catch {
    return false;
  }
}
