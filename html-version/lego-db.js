/**
 * lego-db.js  —  Global Bricks Manager
 * Charge lego_db.json.gz depuis GitHub Pages, peuple IndexedDB,
 * vérifie les mises à jour au démarrage.
 * Version 2.0 — remplace l'import CSV fichier par fichier.
 */

// ── Configuration ─────────────────────────────────────────────────────────────
// Remplacez par votre URL GitHub Pages réelle après le premier déploiement
const DB_META_URL = "https://jfexwana.github.io/global-bricks-manager/dist/lego_db_meta.json";
const DB_GZ_URL   = "https://jfexwana.github.io/global-bricks-manager/dist/lego_db.json.gz";

const IDB_NAME    = "LegoBricksDB";
const IDB_VERSION = 3; // incrémenter si le schéma change
const STORES      = ["parts", "part_categories", "colors", "inventory_parts",
                     "sets_autocomplete", "sets_cache", "metadata"];

// ── Ouverture / Init IndexedDB ────────────────────────────────────────────────
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      const storeConfigs = {
        parts:             { keyPath: "part_num", indexes: [
          { name: "part_cat_id", keyPath: "part_cat_id" },
          { name: "name",        keyPath: "name" },
        ]},
        part_categories:   { keyPath: "id" },
        colors:            { keyPath: "id" },
        inventory_parts:   { keyPath: ["part_num", "color_id"], indexes: [
          { name: "part_num",  keyPath: "part_num" },
          { name: "color_id",  keyPath: "color_id" },
        ]},
        sets_autocomplete: { keyPath: "set_num", indexes: [
          { name: "name", keyPath: "name" },
        ]},
        sets_cache:        { keyPath: "set_num" }, // cache des sets récupérés via API
        metadata:          { keyPath: "key" },
      };

      for (const [name, cfg] of Object.entries(storeConfigs)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: Array.isArray(cfg.keyPath) ? cfg.keyPath : cfg.keyPath,
          autoIncrement: false,
        });
        for (const idx of (cfg.indexes || [])) {
          store.createIndex(idx.name, idx.keyPath, { unique: false });
        }
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Helpers IDB ───────────────────────────────────────────────────────────────

function idbGet(storeName, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbGetAll(storeName) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbGetByIndex(storeName, indexName, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, "readonly");
    const idx   = tx.objectStore(storeName).index(indexName);
    const req   = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPutBatch(storeName, items, onProgress) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const CHUNK = 500;
    let offset  = 0;

    function nextChunk() {
      if (offset >= items.length) { resolve(); return; }
      const chunk = items.slice(offset, offset + CHUNK);
      offset += CHUNK;
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      chunk.forEach(item => store.put(item));
      tx.oncomplete = () => {
        if (onProgress) onProgress(Math.min(offset, items.length), items.length);
        nextChunk();
      };
      tx.onerror = () => reject(tx.error);
    }
    nextChunk();
  }));
}

function idbPut(storeName, item) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function idbDelete(storeName, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function idbCount(storeName) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// ── Métadonnées ───────────────────────────────────────────────────────────────

async function getMeta(key) {
  const row = await idbGet("metadata", key);
  return row ? row.value : null;
}

async function setMeta(key, value) {
  await idbPut("metadata", { key, value });
}

// ── Vérification de mise à jour ───────────────────────────────────────────────

/**
 * Vérifie si une nouvelle version de lego_db.json.gz est disponible.
 * Retourne { needsUpdate: bool, remote: metaObj|null, local: versionString|null }
 */
async function checkForUpdate() {
  const localVersion   = await getMeta("db_version");
  const localGenerated = await getMeta("db_generated_at");

  let remote = null;
  try {
    const resp = await fetch(DB_META_URL + "?_=" + Date.now(), { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    remote = await resp.json();
  } catch (e) {
    console.warn("[lego-db] Impossible de vérifier les mises à jour :", e.message);
    return { needsUpdate: false, remote: null, local: localVersion };
  }

  const needsUpdate = !localVersion
    || remote.version !== localVersion
    || remote.generated_at !== localGenerated;

  return { needsUpdate, remote, local: localVersion };
}

// ── Téléchargement et import ──────────────────────────────────────────────────

/**
 * Télécharge lego_db.json.gz, décompresse via DecompressionStream,
 * et peuple IndexedDB. onProgress(step, pct) est appelé régulièrement.
 */
async function downloadAndImport(onProgress) {
  onProgress && onProgress("download", 0);

  // 1. Téléchargement avec suivi progression
  const resp = await fetch(DB_GZ_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Échec téléchargement : HTTP ${resp.status}`);

  const contentLength = parseInt(resp.headers.get("Content-Length") || "0");
  let received = 0;
  const reader  = resp.body.getReader();
  const chunks  = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength && onProgress) {
      onProgress("download", Math.round((received / contentLength) * 40)); // 0-40%
    }
  }

  // 2. Décompression via DecompressionStream (natif sur navigateurs modernes)
  onProgress && onProgress("decompress", 40);
  const compressed   = new Blob(chunks);
  const ds           = new DecompressionStream("gzip");
  const decompressed = compressed.stream().pipeThrough(ds);
  const text         = await new Response(decompressed).text();
  onProgress && onProgress("parse", 50);

  // 3. Parsing JSON
  let db;
  try {
    db = JSON.parse(text);
  } catch (e) {
    throw new Error("Fichier lego_db.json.gz corrompu : " + e.message);
  }
  onProgress && onProgress("import", 55);

  // 4. Import dans IndexedDB (5 tables)
  const tables = [
    { store: "part_categories",   data: db.categories,        label: "catégories" },
    { store: "colors",            data: db.colors,            label: "couleurs" },
    { store: "parts",             data: db.parts,             label: "pièces" },
    { store: "inventory_parts",   data: db.inventory_parts,   label: "inventaire pièces" },
    { store: "sets_autocomplete", data: db.sets_autocomplete, label: "sets autocomplete" },
  ];

  let tablesDone = 0;
  for (const t of tables) {
    await idbPutBatch(t.store, t.data, (done, total) => {
      const tableBase = 55 + (tablesDone / tables.length) * 40;
      const tablePct  = (done / total) * (40 / tables.length);
      onProgress && onProgress("import_" + t.label, Math.round(tableBase + tablePct));
    });
    tablesDone++;
    console.log(`[lego-db] ${t.label} : ${t.data.length} enregistrements importés`);
  }

  // 5. Sauvegarde des métadonnées
  await setMeta("db_version",      db.version);
  await setMeta("db_generated_at", db.generated_at);
  await setMeta("db_stats",        db.stats);
  await setMeta("db_last_import",  new Date().toISOString());

  onProgress && onProgress("done", 100);
  console.log("[lego-db] Import terminé", db.stats);
  return db.stats;
}

// ── API publique lecture ──────────────────────────────────────────────────────

const LegoDb = {

  // ── Init / status ────────────────────────────────────────────────────────

  async isReady() {
    const count = await idbCount("parts");
    return count > 0;
  },

  async getStats() {
    return await getMeta("db_stats");
  },

  async getLastImport() {
    return await getMeta("db_last_import");
  },

  async getDbVersion() {
    return await getMeta("db_version");
  },

  checkForUpdate,
  downloadAndImport,

  // ── Catégories ───────────────────────────────────────────────────────────

  async getAllCategories() {
    return await idbGetAll("part_categories");
  },

  async getCategoryById(id) {
    return await idbGet("part_categories", id);
  },

  // ── Couleurs ─────────────────────────────────────────────────────────────

  async getAllColors() {
    return await idbGetAll("colors");
  },

  async getColorById(id) {
    return await idbGet("colors", parseInt(id));
  },

  // ── Pièces ───────────────────────────────────────────────────────────────

  async getAllParts() {
    return await idbGetAll("parts");
  },

  async getPartByNum(partNum) {
    return await idbGet("parts", partNum);
  },

  async getPartsByCategory(catId) {
    return await idbGetByIndex("parts", "part_cat_id", catId);
  },

  async searchParts(query) {
    const all = await idbGetAll("parts");
    const q   = query.toLowerCase();
    return all.filter(p =>
      p.part_num.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q)
    );
  },

  // ── Inventory parts ───────────────────────────────────────────────────────

  async getInventoryPartsByPartNum(partNum) {
    return await idbGetByIndex("inventory_parts", "part_num", partNum);
  },

  async getInventoryPartsByColorId(colorId) {
    return await idbGetByIndex("inventory_parts", "color_id", colorId);
  },

  async getInventoryPart(partNum, colorId) {
    return await idbGet("inventory_parts", [partNum, parseInt(colorId)]);
  },

  /**
   * Retourne toutes les inventory_parts d'une catégorie donnée.
   * (joint parts → inventory_parts)
   */
  async getInventoryPartsByCategory(catId) {
    const parts    = await idbGetByIndex("parts", "part_cat_id", catId);
    const partNums = new Set(parts.map(p => p.part_num));
    const all      = await idbGetAll("inventory_parts");
    return all.filter(ip => partNums.has(ip.part_num));
  },

  // ── Sets autocomplétion ───────────────────────────────────────────────────

  async searchSetsLocal(query, limit = 5) {
    const all = await idbGetAll("sets_autocomplete");
    const q   = query.toLowerCase();
    return all
      .filter(s =>
        s.set_num.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      )
      .slice(0, limit);
  },

  async getSetAutocomplete(setNum) {
    return await idbGet("sets_autocomplete", setNum);
  },

  // ── Cache sets API ────────────────────────────────────────────────────────
  // Les données complètes d'un set (récupérées via API Rebrickable)
  // sont mises en cache ici pour éviter les appels répétés.

  async getCachedSet(setNum) {
    return await idbGet("sets_cache", setNum);
  },

  async setCachedSet(setData) {
    // setData doit avoir un champ set_num
    await idbPut("sets_cache", {
      ...setData,
      set_num:    setData.set_num || setData.number || "", 
      _cached_at: new Date().toISOString(),
    });
  },

  async deleteCachedSet(setNum) {
    await idbDelete("sets_cache", setNum);
  },

  /**
   * Met à jour la liste des set_num dans le cache à partir des données API.
   * Utile pour enrichir l'autocomplétion avec les métadonnées API (img_url, etc.)
   */
  async enrichSetAutocomplete(setNum, extraData) {
    const existing = await idbGet("sets_autocomplete", setNum);
    if (existing) {
      await idbPut("sets_autocomplete", { ...existing, ...extraData });
    } else {
      await idbPut("sets_autocomplete", { set_num: setNum, ...extraData });
    }
  },

  // ── Reset ─────────────────────────────────────────────────────────────────

  async clearCatalog() {
    await openDB();
    for (const store of ["parts", "part_categories", "colors", "inventory_parts", "sets_autocomplete"]) {
      await new Promise((resolve, reject) => {
        const tx  = _db.transaction(store, "readwrite");
        const req = tx.objectStore(store).clear();
        req.onsuccess = resolve;
        req.onerror   = reject;
      });
    }
    await idbDelete("metadata", "db_version");
    await idbDelete("metadata", "db_generated_at");
    await idbDelete("metadata", "db_stats");
    console.log("[lego-db] Catalogue effacé");
  },
};

window.LegoDb = LegoDb;