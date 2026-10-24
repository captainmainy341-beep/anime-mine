const THEMES = new Set(['classic', 'compact', 'minimal']);

export function subtitleAppearance(settings = {}) {
  const theme = THEMES.has(settings.subtitleTheme) ? settings.subtitleTheme : 'classic';
  return {
    themeClass: `subtitle-theme-${theme}`,
    hideBox: settings.subtitleBox === false,
  };
}
