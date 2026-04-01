/**
 * theme.js — Global Bricks Manager
 * Gestion centralisée du thème (dark/light).
 * À inclure en premier script sur chaque page HTML.
 */

(function () {
  const PREF_KEY = 'gbm_theme';

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body && document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body && document.body.classList.remove('dark');
    }
  }

  function getSavedTheme() {
    // Lire depuis localStorage directement (sans dépendre de UnifiedDataManager)
    try {
      const raw = localStorage.getItem('gbm_unified_v2');
      if (raw) {
        const data = JSON.parse(raw);
        return data?.user?.preferences?.theme || 'light';
      }
    } catch (e) {}
    return localStorage.getItem(PREF_KEY) || 'light';
  }

  function saveTheme(theme) {
    localStorage.setItem(PREF_KEY, theme);
    // Sync dans UnifiedDataManager si disponible
    if (window.UnifiedDataManager) {
      UnifiedDataManager.setPreference('theme', theme);
    } else {
      // Patch direct dans le JSON stocké
      try {
        const raw = localStorage.getItem('gbm_unified_v2');
        if (raw) {
          const data = JSON.parse(raw);
          if (data?.user?.preferences) {
            data.user.preferences.theme = theme;
            localStorage.setItem('gbm_unified_v2', JSON.stringify(data));
          }
        }
      } catch (e) {}
    }
  }

  function toggleTheme() {
    const current = getSavedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    applyTheme(next);
    // Mettre à jour tous les boutons toggle de la page
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
      btn.title = next === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
    });
    return next;
  }

  // Appliquer immédiatement (avant DOMContentLoaded pour éviter le flash)
  applyTheme(getSavedTheme());

  // Ré-appliquer après chargement du body (au cas où body n'existe pas encore)
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getSavedTheme());
    // Auto-init des boutons .theme-toggle-btn
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      const theme = getSavedTheme();
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
      btn.addEventListener('click', toggleTheme);
    });
  });

  // API publique
  window.GBMTheme = { apply: applyTheme, get: getSavedTheme, save: saveTheme, toggle: toggleTheme };
})();