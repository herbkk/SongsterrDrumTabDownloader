export const BASE_THEMES = [
    { id: 'classic-dark', name: 'Classic Dark', primary: '#0f172a', secondary: '#1e293b' },
    { id: 'clean-light', name: 'Clean Light', primary: '#f8fafc', secondary: '#ffffff' },
    { id: 'nord', name: 'Nord', primary: '#2e3440', secondary: '#3b4252' },
    { id: 'dracula', name: 'Dracula', primary: '#282a36', secondary: '#44475a' }
];

export const THEMES = [
    { id: 'turquoise-glow', name: 'Turquoise Glow', primary: '#06b6d4', secondary: '#8b5cf6' },
    { id: 'amber-flame', name: 'Amber Flame', primary: '#f59e0b', secondary: '#ef4444' },
    { id: 'ocean-blue', name: 'Ocean Blue', primary: '#3b82f6', secondary: '#06b6d4' },
    { id: 'electric-purple', name: 'Electric Purple', primary: '#a855f7', secondary: '#ec4899' },
    { id: 'emerald-night', name: 'Emerald Night', primary: '#10b981', secondary: '#14b8a6' },
    { id: 'sunset-rose', name: 'Sunset Rose', primary: '#f43f5e', secondary: '#f97316' }
];

export let currentBaseTheme = localStorage.getItem('songsterr_base_theme') || 'clean-light';
export let currentTheme = localStorage.getItem('songsterr_theme') || 'turquoise-glow';

export function setTheme(themeId) {
    const theme = THEMES.find(t => t.id === themeId);
    if (!theme) return;

    currentTheme = themeId;
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('songsterr_theme', themeId);

    // Update the picker UI
    document.querySelectorAll('#theme-grid .theme-card').forEach(card => {
        if (card.dataset.themeId === themeId) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}

export function renderThemePicker() {
    const grid = document.getElementById('theme-grid');
    if (!grid) return;

    grid.innerHTML = THEMES.map(t => {
        const isActive = t.id === currentTheme;
        return `
            <div class="theme-card ${isActive ? 'active' : ''}" data-theme-id="${t.id}" onclick="window.setTheme('${t.id}')">
                <div class="theme-swatch" style="background: linear-gradient(135deg, ${t.primary}, ${t.secondary})"></div>
                <div class="theme-card-name">${t.name}</div>
            </div>
        `;
    }).join('');
}

export function setBaseTheme(themeId) {
    const theme = BASE_THEMES.find(t => t.id === themeId);
    if (!theme) return;

    currentBaseTheme = themeId;
    document.documentElement.setAttribute('data-base-theme', themeId);
    localStorage.setItem('songsterr_base_theme', themeId);

    // Update PWA status bar color to match the app background
    setTimeout(() => {
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            const bodyColor = getComputedStyle(document.body).getPropertyValue('--bg-body').trim() || theme.primary;
            metaThemeColor.setAttribute('content', bodyColor);
        }
    }, 50);

    // Update the picker UI
    document.querySelectorAll('#base-theme-grid .theme-card').forEach(card => {
        if (card.dataset.themeId === themeId) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}

export function renderBaseThemePicker() {
    const grid = document.getElementById('base-theme-grid');
    if (!grid) return;

    grid.innerHTML = BASE_THEMES.map(t => {
        const isActive = t.id === currentBaseTheme;
        return `
            <div class="theme-card ${isActive ? 'active' : ''}" data-theme-id="${t.id}" onclick="window.setBaseTheme('${t.id}')">
                <div class="theme-swatch" style="background: linear-gradient(135deg, ${t.primary}, ${t.secondary})"></div>
                <div class="theme-card-name">${t.name}</div>
            </div>
        `;
    }).join('');
}

export function initTheme() {
    setBaseTheme(currentBaseTheme);
    setTheme(currentTheme);
    renderBaseThemePicker();
    renderThemePicker();
}

// Expose for inline handlers
window.setTheme = setTheme;
window.setBaseTheme = setBaseTheme;
