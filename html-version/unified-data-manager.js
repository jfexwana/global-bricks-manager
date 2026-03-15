// unified-data-manager.js - Gestionnaire de données unifié
class UnifiedDataManager {
  constructor() {
    this.UNIFIED_SAVE_KEY = 'lego_unified_data_v2';
    this._saveTimeout = null; // AJOUTER cette ligne
    this.currentData = {
      version: "2.0",
      timestamp: new Date().toISOString(),
      user: {
        preferences: {
          theme: 'light',
          autoSave: true,
          apiKey: localStorage.getItem('rebrickable_api_key') || ''
        }
      },
      inventory: [],
      sets: []
    };
  }

// Sauvegarde immédiate (pour export, navigation)
async saveUnifiedData() {
  return this._doSave();
}

// Sauvegarde différée (pour +/- pièces répétitifs)
scheduleSave() {
  if (this._saveTimeout) clearTimeout(this._saveTimeout);
  this._saveTimeout = setTimeout(() => this._doSave(), 500);
}

async _doSave() {
  try {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
    this.currentData.timestamp = new Date().toISOString();
    localStorage.setItem(this.UNIFIED_SAVE_KEY, JSON.stringify(this.currentData));
    return true;
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    return false;
  }
}

  // Ajouter cette méthode dans UnifiedDataManager
cleanupLegacyStorage() {
  // Supprimer les anciens systèmes de sauvegarde après migration
  const legacyKeys = [
    'lego_personal_inventory',
    'lego_sets_data', 
    'GlobalBricks_Save_Bulk',
    'darkMode' // Maintenant dans user.preferences.theme
  ];
  
  legacyKeys.forEach(key => {
    if (localStorage.getItem(key)) {
      console.log(`Suppression de l'ancienne clé: ${key}`);
      localStorage.removeItem(key);
    }
  });
}

// Obtenir le nom d'une pièce depuis IndexedDB
async getPartName(partNum) {
  try {
    if (window.legoDb) {
      const parts = await window.legoDb.getData('parts');
      const part = parts.find(p => p.part_num === partNum);
      return part ? part.name : 'Pièce inconnue';
    }
    return 'Pièce inconnue';
  } catch (error) {
    console.error('Erreur récupération nom pièce:', error);
    return 'Pièce inconnue';
  }
}

  // Charger les données unifiées
  async loadUnifiedData() {
    try {
      const saved = localStorage.getItem(this.UNIFIED_SAVE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        
        // Migration depuis l'ancien format si nécessaire
        if (!data.version || data.version !== "2.0") {
          console.log('Migration des données vers le format v2.0...');
          this.currentData = await this.migrateFromLegacyData(data);
        } else {
          this.currentData = data;
        }
        
        console.log('Données unifiées chargées:', this.currentData);
        return this.currentData;
      } else {
        // Première utilisation, essayer de migrer depuis les anciens formats
        console.log('Première utilisation, migration depuis les anciens formats...');
        this.currentData = await this.migrateFromLegacyData();
        await this.saveUnifiedData();
        return this.currentData;
      }
    } catch (error) {
      console.error('Erreur chargement données unifiées:', error);
      return this.currentData;
    }
  }

  // Migrer depuis les anciens formats de données
  async migrateFromLegacyData(existingData = null) {
    const newData = {
      version: "2.0",
      timestamp: new Date().toISOString(),
      user: {
        preferences: {
          theme: localStorage.getItem('darkMode') === 'true' ? 'dark' : 'light',
          autoSave: true,
          apiKey: localStorage.getItem('rebrickable_api_key') || ''
        }
      },
      inventory: [],
      sets: []
    };

    try {
      // Migrer l'inventaire personnel depuis l'ancien format
      const oldInventory = localStorage.getItem('lego_personal_inventory');
      if (oldInventory) {
        const inventory = JSON.parse(oldInventory);
        let inventoryArray = [];
        
        if (Array.isArray(inventory)) {
          inventoryArray = inventory;
        } else if (typeof inventory === 'object') {
          inventoryArray = Object.values(inventory);
        }
        
newData.inventory = await Promise.all(inventoryArray.map(async item => {
  let colorId = item.color_id;
  
  // Si pas de color_id, essayer de le récupérer depuis le nom de couleur
  if (colorId === undefined || colorId === null) {
    colorId = await this.getColorIdByName(item.color_name);
  }
  
  return {
    part_num: item.part_num,
    color_id: colorId, // Ne pas forcer à 0, utiliser la vraie valeur
    color_name: item.color_name,
    quantity: item.quantity,
    category: item.category || 'Unknown'
  };      
}));
      }

      // Migrer les sets depuis l'ancien format
      const oldSets = localStorage.getItem('lego_sets_data');
      if (oldSets) {
        const setsData = JSON.parse(oldSets);
        if (setsData.sets && Array.isArray(setsData.sets)) {
          newData.sets = setsData.sets.map(set => ({
            number: set.number,
            name: set.name,
            parts: set.parts
              .filter(p => !p.isSpare) // Exclure les pièces de rechange
              .map(p => ({
                part_num: p.partNum,
                color_id: p.colorId,
                quantity: p.quantity,
                quantity_owned: p.quantityOwned || 0
              }))
          }));
        }
      }

      console.log('Migration terminée, données converties:', newData);
      // Nettoyer les anciennes clés après migration réussie
setTimeout(() => this.cleanupLegacyStorage(), 2000); // Délai pour éviter race conditions

      return newData;
      
    } catch (error) {
      console.error('Erreur migration des données:', error);
      return newData;
    }
  }

  // Mettre à jour l'inventaire
updateInventory(partNum, colorId, colorName, quantity, category = 'Unknown') {
  const index = this.currentData.inventory.findIndex(
    item => item.part_num === partNum && item.color_id === colorId
  );

  if (quantity <= 0) {
    if (index >= 0) {
      this.currentData.inventory.splice(index, 1);
    }
  } else {
    if (index >= 0) {
      this.currentData.inventory[index].quantity = quantity;
      this.currentData.inventory[index].category = category;
    } else {
      this.currentData.inventory.push({
        part_num: partNum,
        color_id: colorId, // Utiliser color_id comme identifiant principal
        color_name: colorName, // Stocker aussi le nom pour l'affichage
        quantity: quantity,
        category: category
      });
    }
  }
}

  // Obtenir la quantité d'une pièce dans l'inventaire
  getInventoryQuantity(partNum, colorId) {
    const item = this.currentData.inventory.find(
      item => item.part_num === partNum && item.color_id === colorId
    );
    return item ? item.quantity : 0;
  }

  // Mettre à jour un set
  updateSet(setNumber, setName, parts = null) {
    const index = this.currentData.sets.findIndex(set => set.number === setNumber);

    if (index >= 0) {
      // Mettre à jour le set existant
      this.currentData.sets[index].name = setName;
      if (parts) {
        this.currentData.sets[index].parts = parts;
      }
    } else {
      // Ajouter un nouveau set
      this.currentData.sets.push({
        number: setNumber,
        name: setName,
        parts: parts || []
      });
    }
  }

  // Mettre à jour la quantité possédée d'une pièce dans un set
  updateSetPartQuantity(setNumber, partNum, colorId, quantityOwned) {
    const set = this.currentData.sets.find(s => s.number === setNumber);
    if (set) {
      const part = set.parts.find(p => p.part_num === partNum && p.color_id === colorId);
      if (part) {
        part.quantity_owned = Math.max(0, quantityOwned);
      }
    }
  }

  // Supprimer un set
  removeSet(setNumber) {
    this.currentData.sets = this.currentData.sets.filter(set => set.number !== setNumber);
  }

  // Transférer une pièce de l'inventaire vers un set
async transferPartToSet(partNum, colorId, setNumber, quantity) {
  try {
    // Trouver l'item dans l'inventaire par colorId
    const inventoryItem = this.currentData.inventory.find(
      item => item.part_num === partNum && item.color_id === colorId
    );
    
    if (!inventoryItem || inventoryItem.quantity < quantity) {
      throw new Error('Quantité insuffisante dans l\'inventaire');
    }

    // Réduire l'inventaire
    inventoryItem.quantity -= quantity;
    if (inventoryItem.quantity <= 0) {
      this.currentData.inventory = this.currentData.inventory.filter(
        item => !(item.part_num === partNum && item.color_id === colorId)
      );
    }

    // Augmenter la quantité dans le set
    const set = this.currentData.sets.find(s => s.number === setNumber);
    if (set) {
      const part = set.parts.find(p => p.part_num === partNum && p.color_id === colorId);
      if (part) {
        part.quantity_owned = Math.min(part.quantity, part.quantity_owned + quantity);
      }
    }

    await this.saveUnifiedData();
    return true;
    
  } catch (error) {
    console.error('Erreur transfert pièce vers set:', error);
    throw error;
  }
}

  // Obtenir la catégorie d'une pièce
  getPartCategory(partNum, colorName) {
    const item = this.currentData.inventory.find(
      item => item.part_num === partNum && item.color_name === colorName
    );
    return item ? item.category : 'Unknown';
  }

// Obtenir l'ID de couleur par nom (depuis IndexedDB)
async getColorIdByName(colorName) {
  try {
    if (window.legoDb) {
      const colors = await window.legoDb.getData('colors');
      const color = colors.find(c => c.name === colorName);
      if (color) {
        return color.id;
      }
      
      // Si pas trouvé et que c'est "Noir" ou "Black", retourner 0
      if (colorName && (colorName.toLowerCase().includes('noir') || colorName.toLowerCase().includes('black'))) {
        return 0;
      }
    }
    
    // Par défaut, retourner 0 (noir) plutôt qu'une valeur invalide
    return 0;
  } catch (error) {
    console.error('Erreur récupération color_id:', error);
    return 0; // Noir par défaut en cas d'erreur
  }
}

  // Exporter toutes les données
  exportData() {
    const blob = new Blob([JSON.stringify(this.currentData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lego_unified_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Importer des données
// REMPLACER importData() par :

async importData(jsonData) {
  try {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    
    // Validation du schéma minimal
    const errors = [];
    if (!data.version) errors.push('Champ "version" manquant');
    if (!Array.isArray(data.inventory)) errors.push('Champ "inventory" invalide (doit être un tableau)');
    if (!Array.isArray(data.sets)) errors.push('Champ "sets" invalide (doit être un tableau)');
    
    if (errors.length > 0) {
      // Tenter une migration depuis l'ancien format avant d'abandonner
      if (data.unified_data?.version === "2.0") {
        // Format exporté via auth.js (enveloppe avec unified_data)
        return await this.importData(data.unified_data);
      }
      throw new Error(`Fichier invalide : ${errors.join(', ')}`);
    }
    
    // Backup automatique avant écrasement
    const backupKey = `lego_backup_before_import_${Date.now()}`;
    localStorage.setItem(backupKey, JSON.stringify(this.currentData));
    console.log(`Backup créé : ${backupKey}`);
    
    if (data.version === "2.0") {
      this.currentData = data;
    } else {
      this.currentData = await this.migrateFromLegacyData(data);
    }
    
    await this.saveUnifiedData();
    return true;
  } catch (error) {
    console.error('Erreur import données:', error);
    throw new Error('Format de fichier invalide : ' + error.message);
  }
}

  // Obtenir les statistiques
  getStats() {
    return {
      inventoryCount: this.currentData.inventory.length,
      totalInventoryPieces: this.currentData.inventory.reduce((sum, item) => sum + item.quantity, 0),
      setsCount: this.currentData.sets.length,
      completedSets: this.currentData.sets.filter(set => 
        set.parts.every(part => part.quantity_owned >= part.quantity)
      ).length
    };
  }
}

// Rendre disponible globalement
window.UnifiedDataManager = UnifiedDataManager;