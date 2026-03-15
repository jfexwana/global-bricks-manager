// ================================
// auth.js - Version locale uniquement
// ================================

export default class LocalStorageManager {
  constructor(container) {
    this.container = container;
    this.render();
  }

  // ================================
  // Interface utilisateur pour export/import
  // ================================
  render() {
    this.container.innerHTML = `
      <div class="storage-container">
        <h4>Sauvegarde & Export Local</h4>
        
        <div class="storage-actions">
          <button id="export-btn" class="btn btn-primary">
            <i class="bi bi-download"></i> Exporter les données
          </button>
          <button id="import-btn" class="btn btn-secondary">
            <i class="bi bi-upload"></i> Importer les données
          </button>
          <input type="file" id="import-file" accept=".json" style="display: none;">
        </div>
      </div>
    `;

    this.exportBtn = this.container.querySelector('#export-btn');
    this.importBtn = this.container.querySelector('#import-btn');
    this.importFile = this.container.querySelector('#import-file');

    this.exportBtn.addEventListener('click', () => this.exportToFile());
    this.importBtn.addEventListener('click', () => this.importFile.click());
    this.importFile.addEventListener('change', (e) => this.importFromFile(e));
  }

  // ================================
  // Export des données vers un fichier JSON
  // ================================
exportToFile() {
  try {
    const unifiedData = localStorage.getItem('lego_unified_data_v2');
    if (!unifiedData) {
      alert('Aucune donnée à exporter. Utilisez d\'abord l\'application pour créer un inventaire.');
      return;
    }
    
    const data = JSON.parse(unifiedData);
    // Export propre : uniquement le format v2.0, pas les legacy
    const exportData = {
      ...data,
      export_date: new Date().toISOString(),
      export_version: '2.0'
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lego_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('Export réussi');
  } catch (error) {
    console.error('Erreur export:', error);
    alert('Erreur lors de l\'export des données');
  }
}

  // ================================
  // Import des données depuis un fichier JSON
  // ================================
async importFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    let importData;
    
    // Validation JSON
    try {
      importData = JSON.parse(text);
    } catch(e) {
      alert('Fichier invalide : ce n\'est pas un JSON valide.');
      event.target.value = '';
      return;
    }
    
    // Détecter le format et extraire les données v2.0
    let dataToImport = importData;
    if (importData.unified_data) {
      // Ancien format auth.js avec enveloppe
      dataToImport = importData.unified_data;
    }
    
    // Validation minimale
    if (!dataToImport.version || !Array.isArray(dataToImport.inventory) || !Array.isArray(dataToImport.sets)) {
      alert('Fichier invalide : format non reconnu.\nFormats acceptés : export v2.0 ou export legacy.');
      event.target.value = '';
      return;
    }
    
    // Afficher un résumé avant import
    const summary = `Données à importer :
- ${dataToImport.inventory.length} références de pièces
- ${dataToImport.sets.length} sets
- Exporté le : ${dataToImport.export_date || dataToImport.timestamp || 'date inconnue'}

Cela remplacera vos données actuelles. Continuer ?`;
    
    if (!confirm(summary)) {
      event.target.value = '';
      return;
    }
    
    // Backup avant écrasement
    const currentData = localStorage.getItem('lego_unified_data_v2');
    if (currentData) {
      localStorage.setItem(`lego_backup_before_import_${Date.now()}`, currentData);
    }
    
    localStorage.setItem('lego_unified_data_v2', JSON.stringify(dataToImport));
    alert('Données importées avec succès ! Rechargez la page.');
    
  } catch (error) {
    console.error('Erreur import:', error);
    alert('Erreur lors de l\'import : ' + error.message);
  }
  
  event.target.value = '';
}
}