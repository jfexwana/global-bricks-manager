// ================================
// auth.js — Version locale uniquement
// Correction v2.3 : clé localStorage alignée sur gbm_unified_v2
// ================================

export default class LocalStorageManager {
  constructor(container) {
    this.container = container;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      
        
          
             Exporter les données
          
          
             Importer les données
          
          
        
        
      
    `;

    this.exportBtn  = this.container.querySelector('#export-btn');
    this.importBtn  = this.container.querySelector('#import-btn');
    this.importFile = this.container.querySelector('#import-file');
    this.infoEl     = this.container.querySelector('#storage-info');

    this.exportBtn.addEventListener('click',  () => this.exportToFile());
    this.importBtn.addEventListener('click',  () => this.importFile.click());
    this.importFile.addEventListener('change', e => this.importFromFile(e));

    this._updateInfo();
  }

  _updateInfo() {
    if (!this.infoEl) return;
    try {
      const raw = localStorage.getItem('gbm_unified_v2'); // ← clé corrigée
      if (!raw) { this.infoEl.textContent = 'Aucune donnée sauvegardée.'; return; }
      const data = JSON.parse(raw);
      const sets = data.sets?.length ?? 0;
      const inv  = data.inventory?.length ?? 0;
      const ts   = data.timestamp ? new Date(data.timestamp).toLocaleString('fr-FR') : '—';
      this.infoEl.textContent = `${sets} set(s) · ${inv} référence(s) en vrac · Sauvegarde : ${ts}`;
    } catch (e) {
      this.infoEl.textContent = 'Erreur lecture données.';
    }
  }

  exportToFile() {
    try {
      // Déléguer à UnifiedDataManager si disponible (source de vérité)
      let jsonStr;
      if (window.UnifiedDataManager) {
        jsonStr = UnifiedDataManager.exportData();
      } else {
        const raw = localStorage.getItem('gbm_unified_v2'); // ← clé corrigée
        if (!raw) {
          alert('Aucune donnée à exporter.');
          return;
        }
        jsonStr = raw;
      }

      const data = JSON.parse(jsonStr);
      const exportData = {
        ...data,
        export_date:    new Date().toISOString(),
        export_version: '2.3',
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `gbm_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('[auth] Export réussi');
    } catch (error) {
      console.error('[auth] Erreur export:', error);
      alert('Erreur lors de l\'export des données : ' + error.message);
    }
  }

  async importFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let importData;

      try {
        importData = JSON.parse(text);
      } catch (e) {
        alert('Fichier invalide : ce n\'est pas un JSON valide.');
        event.target.value = '';
        return;
      }

      // Compatibilité avec l'ancienne enveloppe auth.js
      let dataToImport = importData;
      if (importData.unified_data) {
        dataToImport = importData.unified_data;
      }

      // Validation minimale
      if (!Array.isArray(dataToImport.inventory) || !Array.isArray(dataToImport.sets)) {
        alert('Fichier invalide : format non reconnu.\nLes champs "inventory" et "sets" sont requis.');
        event.target.value = '';
        return;
      }

      const sets = dataToImport.sets?.length ?? 0;
      const inv  = dataToImport.inventory?.length ?? 0;
      const ts   = dataToImport.export_date || dataToImport.timestamp || 'date inconnue';

      const summary = `Données à importer :\n- ${sets} set(s)\n- ${inv} référence(s) de pièces\n- Exporté le : ${ts}\n\nCela remplacera vos données actuelles. Continuer ?`;
      if (!confirm(summary)) {
        event.target.value = '';
        return;
      }

      // Backup avant écrasement
      const currentData = localStorage.getItem('gbm_unified_v2'); // ← clé corrigée
      if (currentData) {
        const backupKey = `gbm_backup_${Date.now()}`;
        localStorage.setItem(backupKey, currentData);
        console.log(`[auth] Backup créé : ${backupKey}`);
      }

      // Import via UnifiedDataManager si disponible
      if (window.UnifiedDataManager) {
        UnifiedDataManager.importData(JSON.stringify(dataToImport));
      } else {
        localStorage.setItem('gbm_unified_v2', JSON.stringify(dataToImport)); // ← clé corrigée
      }

      this._updateInfo();
      alert('Données importées avec succès ! La page va se recharger.');
      window.location.reload();

    } catch (error) {
      console.error('[auth] Erreur import:', error);
      alert('Erreur lors de l\'import : ' + error.message);
    }

    event.target.value = '';
  }
}