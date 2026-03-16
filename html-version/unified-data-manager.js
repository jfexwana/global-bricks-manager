/**
 * unified-data-manager.js  —  Global Bricks Manager
 * Gestion centralisée des données utilisateur (inventaire + sets).
 * v2.2 — corrections paramètres updateInventory, ajout scheduleSave, getApiKey statique
 */

const STORAGE_KEY    = "gbm_unified_v2";
const STORAGE_KEY_V1 = "lego_personal_inventory";
const STORAGE_KEY_S1 = "lego_sets_data";

function emptyData() {
  return {
    version:   "2.2",
    timestamp: new Date().toISOString(),
    user: {
      preferences: {
        theme:    "light",
        autoSave: true,
        apiKey:   "",
      },
    },
    inventory: [],
    sets:      [],
  };
}

function loadUnifiedData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      return migrateTo22(data);
    } catch (e) {
      console.error("[UDM] Données corrompues, reset", e);
    }
  }
  const migrated = migrateFromLegacy();
  if (migrated) return migrated;
  return emptyData();
}

function saveUnifiedData(data) {
  data.timestamp = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      console.error("[UDM] localStorage plein !");
    }
    throw e;
  }
}

function migrateTo22(data) {
  if (data.version === "2.2") return data;
  data.version = "2.2";
  (data.sets || []).forEach(s => {
    if (!s.year)      s.year      = 0;
    if (!s.img_url)   s.img_url   = "";
    if (!s.num_parts) s.num_parts = 0;
  });
  return data;
}

function migrateFromLegacy() {
  const rawInv  = localStorage.getItem(STORAGE_KEY_V1);
  const rawSets = localStorage.getItem(STORAGE_KEY_S1);
  if (!rawInv && !rawSets) return null;

  const data = emptyData();
  if (rawInv) {
    try {
      const inv = JSON.parse(rawInv);
      data.inventory = Object.entries(inv).flatMap(([key, qty]) => {
        const [part_num, color_id] = key.split("_");
        return qty > 0 ? [{
          part_num,
          color_id:   parseInt(color_id) || 0,
          color_name: "",
          quantity:   qty,
          category:   "",
        }] : [];
      });
    } catch (e) { console.warn("[UDM] Migration inventaire échouée", e); }
  }
  if (rawSets) {
    try {
      const sets = JSON.parse(rawSets);
      data.sets = Array.isArray(sets) ? sets.map(s => ({
        number:    s.number || s.set_num || "",
        name:      s.name || "",
        year:      s.year || 0,
        num_parts: s.num_parts || 0,
        img_url:   s.img_url || "",
        parts:     (s.parts || []).map(p => ({
          part_num:       p.part_num || p.partNum || "",
          color_id:       parseInt(p.color_id || p.colorId) || 0,
          quantity:       p.quantity || 0,
          quantity_owned: p.quantity_owned || p.quantityOwned || 0,
          is_spare:       p.is_spare || false,
          is_minifig:     p.is_minifig || false,
        })),
      })) : [];
    } catch (e) { console.warn("[UDM] Migration sets échouée", e); }
  }
  saveUnifiedData(data);
  localStorage.removeItem(STORAGE_KEY_V1);
  localStorage.removeItem(STORAGE_KEY_S1);
  console.log("[UDM] Migration legacy effectuée");
  return data;
}

const UnifiedDataManager = {

  _data: null,
  _saveTimer: null,

  load() {
    this._data = loadUnifiedData();
    return this._data;
  },

  // Alias pour compatibilité avec app.html (appelé comme méthode d'instance)
  loadUnifiedData() {
    return Promise.resolve(this.load());
  },

  save() {
    if (!this._data) return;
    saveUnifiedData(this._data);
  },

  // Alias pour compatibilité avec app.html
  saveUnifiedData() {
    return Promise.resolve(this.save());
  },

  // Sauvegarde différée (debounce 500ms) — évite les sauvegardes trop fréquentes
  scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.save();
      this._saveTimer = null;
    }, 500);
  },

  get data() {
    if (!this._data) this.load();
    return this._data;
  },

  // Compatibilité avec app.html qui accède à .currentData
  get currentData() {
    return this.data;
  },

  // ── Préférences ────────────────────────────────────────────────────────────

  getPreference(key) {
    return this.data.user.preferences[key];
  },

  setPreference(key, value) {
    this.data.user.preferences[key] = value;
    this.save();
  },

  // Méthode d'instance
  getApiKey() {
    return this.data.user.preferences.apiKey
      || localStorage.getItem("rebrickable_api_key")
      || "";
  },

  // Méthode statique (pour sets.html qui l'appelle en UnifiedDataManager.getApiKey())
  setApiKey(key) {
    this.data.user.preferences.apiKey = key;
    localStorage.setItem("rebrickable_api_key", key);
    this.save();
  },

  // ── Inventaire pièces en vrac ──────────────────────────────────────────────

  getInventoryQuantity(partNum, colorId) {
    const item = this.data.inventory.find(
      i => i.part_num === partNum && i.color_id === parseInt(colorId)
    );
    return item ? item.quantity : 0;
  },

  // Ordre unifié : (partNum, colorId, quantity, colorName, category)
  // app.html appelait (partNum, colorId, colorName, quantity, category) — corrigé côté app.html
  updateInventory(partNum, colorId, quantity, colorName = "", category = "") {
    const idx = this.data.inventory.findIndex(
      i => i.part_num === partNum && i.color_id === parseInt(colorId)
    );
    if (quantity <= 0) {
      if (idx >= 0) this.data.inventory.splice(idx, 1);
    } else {
      const item = {
        part_num:   partNum,
        color_id:   parseInt(colorId),
        color_name: colorName,
        quantity,
        category,
      };
      if (idx >= 0) this.data.inventory[idx] = item;
      else          this.data.inventory.push(item);
    }
    this.save();
  },

  getInventory() {
    return this.data.inventory;
  },

  // ── Sets ───────────────────────────────────────────────────────────────────

  getSets() {
    return this.data.sets;
  },

  getSet(setNumber) {
    return this.data.sets.find(s => s.number === setNumber) || null;
  },

  async saveSet(setData) {
    const idx = this.data.sets.findIndex(s => s.number === setData.number);
   const normalized = {
  number:    setData.number,
  name:      setData.name || "",
  year:      setData.year || 0,
  num_parts: setData.num_parts || setData.numParts || 0,
  img_url:   setData.img_url || setData.imgUrl || "",
  minifigs:  (setData.minifigs || []).map(m => ({  // ← AJOUT
    set_num:   m.set_num   || "",
    name:      m.name      || "",
    quantity:  m.quantity  || 1,
    img_url:   m.img_url   || "",
    num_parts: m.num_parts || 0,
  })),
  parts: (setData.parts || []).map(p => ({
    part_num:       p.part_num       || p.partNum  || "",
    name:           p.name           || "",
    color_id:       parseInt(p.color_id || p.colorId) || 0,
    color_name:     p.color_name     || p.colorName || "",
    img_url:        p.img_url        || p.imgUrl    || "",
    quantity:       p.quantity       || 0,
    quantity_owned: p.quantity_owned || p.quantityOwned || 0,
    is_spare:       p.is_spare       || false,
    is_minifig:     p.is_minifig     || false,
    minifig_ref:    p.minifig_ref    || null,  // ← AJOUT
  })),
};
    if (idx >= 0) this.data.sets[idx] = normalized;
    else          this.data.sets.push(normalized);
    this.save();

    if (window.LegoDb) {
      await LegoDb.setCachedSet(normalized).catch(e =>
        console.warn("[UDM] Cache IndexedDB set échoué", e)
      );
    }
    return normalized;
  },

  removeSet(setNumber) {
    const idx = this.data.sets.findIndex(s => s.number === setNumber);
    if (idx >= 0) this.data.sets.splice(idx, 1);
    this.save();
    if (window.LegoDb) {
      LegoDb.deleteCachedSet(setNumber).catch(() => {});
    }
  },

  updateSetPartQuantity(setNumber, partNum, colorId, quantityOwned) {
    const set = this.getSet(setNumber);
    if (!set) return;
    const part = set.parts.find(
      p => p.part_num === partNum && p.color_id === parseInt(colorId)
    );
    if (part) {
      part.quantity_owned = Math.max(0, Math.min(quantityOwned, part.quantity));
    }
    this.save();
  },

  // ── Transfert inventaire ↔ set ─────────────────────────────────────────────

  transferPartToSet(setNumber, partNum, colorId, qtyToTransfer) {
    const colorIdInt = parseInt(colorId);
    const set = this.getSet(setNumber);
    if (!set) return { success: false, error: "Set introuvable" };

    const part = set.parts.find(
      p => p.part_num === partNum && p.color_id === colorIdInt
    );
    if (!part) return { success: false, error: "Pièce introuvable dans le set" };

    const missing  = part.quantity - part.quantity_owned;
    const transfer = Math.min(qtyToTransfer, missing);
    if (transfer <= 0) return { success: false, error: "Aucun transfert nécessaire" };

    const available = this.getInventoryQuantity(partNum, colorIdInt);
    if (available < transfer) return { success: false, error: "Inventaire insuffisant" };

    this.updateInventory(
      partNum, colorIdInt,
      available - transfer,
      part.color_name || "",
      ""
    );
    part.quantity_owned += transfer;
    this.save();
    return { success: true, transferred: transfer };
  },

  transferPartFromSet(setNumber, partNum, colorId, qtyToReturn) {
    const colorIdInt = parseInt(colorId);
    const set = this.getSet(setNumber);
    if (!set) return { success: false, error: "Set introuvable" };

    const part = set.parts.find(
      p => p.part_num === partNum && p.color_id === colorIdInt
    );
    if (!part) return { success: false, error: "Pièce introuvable dans le set" };

    const transfer = Math.min(qtyToReturn, part.quantity_owned);
    if (transfer <= 0) return { success: false, error: "Aucune pièce à retourner" };

    part.quantity_owned -= transfer;
    const current = this.getInventoryQuantity(partNum, colorIdInt);
    this.updateInventory(
      partNum, colorIdInt,
      current + transfer,
      part.color_name || "",
      ""
    );
    this.save();
    return { success: true, returned: transfer };
  },

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats() {
    const sets      = this.data.sets;
    const inventory = this.data.inventory;
    const completeSets = sets.filter(s => {
      if (!s.parts.length) return false;
      return s.parts.every(p => p.quantity_owned >= p.quantity);
    });
    const totalOwnedParts = inventory.reduce((sum, i) => sum + i.quantity, 0);

    return {
      totalSets:      sets.length,
      completeSets:   completeSets.length,
      incompleteSets: sets.length - completeSets.length,
      totalInventory: inventory.length,
      totalOwnedParts,
    };
  },

  // ── Export / Import ────────────────────────────────────────────────────────

  exportData() {
    return JSON.stringify(this.data, null, 2);
  },

  importData(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("JSON invalide : " + e.message);
    }
    if (!parsed.inventory || !parsed.sets) {
      throw new Error("Format non reconnu (clés inventory et sets requises)");
    }
    this._data = migrateTo22(parsed);
    this.save();
    return this._data;
  },
};

// Méthode statique sur le constructeur (pour sets.html : UnifiedDataManager.getApiKey())
UnifiedDataManager.getApiKey = function() {
  return UnifiedDataManager.getApiKey
    ? (UnifiedDataManager._data?.user?.preferences?.apiKey
       || localStorage.getItem("rebrickable_api_key")
       || "")
    : "";
};
// Réécrire proprement pour éviter la récursion
Object.defineProperty(UnifiedDataManager, 'getApiKey', {
  value: function() {
    const data = UnifiedDataManager._data;
    return (data?.user?.preferences?.apiKey)
      || localStorage.getItem("rebrickable_api_key")
      || "";
  },
  writable: true,
  configurable: true,
});

UnifiedDataManager.load();
window.UnifiedDataManager = UnifiedDataManager;