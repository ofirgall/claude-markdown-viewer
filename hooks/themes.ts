// Palettes for the preview page, from popular MIT-licensed themes. Each names
// its counterpart, which the page's light/dark button switches to. `github`,
// the default, is app.css's own dark and light colors (from nvim-md-preview),
// and starts in the system's mode.

type Palette = {
  mode: 'dark' | 'light'
  pair: string
  bg: string; panel: string; stroke: string; fg: string; muted: string; code: string
  red: string; yellow: string; green: string; cyan: string; blue: string; purple: string
}

export const THEMES: Record<string, Palette> = {
  'catppuccin-mocha': { mode: 'dark', pair: 'catppuccin-latte', bg: '#1e1e2e', panel: '#181825', stroke: '#313244', fg: '#cdd6f4', muted: '#a6adc8', code: '#181825', red: '#f38ba8', yellow: '#f9e2af', green: '#a6e3a1', cyan: '#94e2d5', blue: '#89b4fa', purple: '#cba6f7' },
  'catppuccin-latte': { mode: 'light', pair: 'catppuccin-mocha', bg: '#eff1f5', panel: '#e6e9ef', stroke: '#ccd0da', fg: '#4c4f69', muted: '#6c6f85', code: '#e6e9ef', red: '#d20f39', yellow: '#df8e1d', green: '#40a02b', cyan: '#179299', blue: '#1e66f5', purple: '#8839ef' },
  'tokyo-night': { mode: 'dark', pair: 'tokyo-day', bg: '#1a1b26', panel: '#16161e', stroke: '#292e42', fg: '#c0caf5', muted: '#737aa2', code: '#16161e', red: '#f7768e', yellow: '#e0af68', green: '#9ece6a', cyan: '#7dcfff', blue: '#7aa2f7', purple: '#bb9af7' },
  'tokyo-day': { mode: 'light', pair: 'tokyo-night', bg: '#e1e2e7', panel: '#d0d5e3', stroke: '#c4c8da', fg: '#3760bf', muted: '#6172b0', code: '#d0d5e3', red: '#f52a65', yellow: '#8c6c3e', green: '#587539', cyan: '#007197', blue: '#2e7de9', purple: '#9854f1' },
  'gruvbox-dark': { mode: 'dark', pair: 'gruvbox-light', bg: '#282828', panel: '#32302f', stroke: '#504945', fg: '#ebdbb2', muted: '#a89984', code: '#32302f', red: '#fb4934', yellow: '#fabd2f', green: '#b8bb26', cyan: '#8ec07c', blue: '#83a598', purple: '#d3869b' },
  'gruvbox-light': { mode: 'light', pair: 'gruvbox-dark', bg: '#fbf1c7', panel: '#f2e5bc', stroke: '#d5c4a1', fg: '#3c3836', muted: '#7c6f64', code: '#f2e5bc', red: '#9d0006', yellow: '#b57614', green: '#79740e', cyan: '#427b58', blue: '#076678', purple: '#8f3f71' },
  'rose-pine': { mode: 'dark', pair: 'rose-pine-dawn', bg: '#191724', panel: '#1f1d2e', stroke: '#26233a', fg: '#e0def4', muted: '#908caa', code: '#1f1d2e', red: '#eb6f92', yellow: '#f6c177', green: '#9ccfd8', cyan: '#9ccfd8', blue: '#31748f', purple: '#c4a7e7' },
  'rose-pine-dawn': { mode: 'light', pair: 'rose-pine', bg: '#faf4ed', panel: '#fffaf3', stroke: '#dfdad9', fg: '#575279', muted: '#797593', code: '#f2e9e1', red: '#b4637a', yellow: '#ea9d34', green: '#56949f', cyan: '#56949f', blue: '#286983', purple: '#907aa9' },
  dracula: { mode: 'dark', pair: 'catppuccin-latte', bg: '#282a36', panel: '#21222c', stroke: '#44475a', fg: '#f8f8f2', muted: '#6272a4', code: '#21222c', red: '#ff5555', yellow: '#f1fa8c', green: '#50fa7b', cyan: '#8be9fd', blue: '#bd93f9', purple: '#ff79c6' },
  nord: { mode: 'dark', pair: 'catppuccin-latte', bg: '#2e3440', panel: '#3b4252', stroke: '#434c5e', fg: '#eceff4', muted: '#9aa3b5', code: '#3b4252', red: '#bf616a', yellow: '#ebcb8b', green: '#a3be8c', cyan: '#88c0d0', blue: '#81a1c1', purple: '#b48ead' },
}

export const DEFAULT_THEME = 'github'

// The built-in look with a few colors changed, in one mode only (the other
// mode keeps the built-in colors, as these may not read on it).
type Variant = { mode: 'dark' | 'light'; vars: Record<string, string> }
const VARIANTS: Record<string, Variant> = {
  // github's dark mode with Claude Code's inline code and bold colors
  'github-dark-ofir': { mode: 'dark', vars: { 'inline-code': '#cba6f7', strong: '#7a9cff' } },
}

// A color goes into CSS as given only if it looks like one: hex, rgb()/hsl()…, or a name.
export const safeColor = (s: unknown): string =>
  typeof s === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|rgba|hsl|hsla|oklch|lab|lch)\([0-9.,%\s/+-]+\))$/.test(s.trim())
    ? s.trim()
    : ''

function vars(p: Palette): string {
  const dark = p.mode === 'dark'
  const v: Record<string, string> = {
    bg: p.bg, panel: p.panel, stroke: p.stroke, fg: p.fg, 'fg-muted': p.muted,
    link: p.blue, accent: p.blue, 'code-bg': p.code,
    'blockquote-border': p.stroke, 'table-border': p.stroke,
    'table-row-alt': dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.025)',
    'scroll-thumb': `color-mix(in srgb, ${p.muted} 45%, transparent)`,
    'badge-bg': `color-mix(in srgb, ${p.fg} 6%, transparent)`, 'badge-fg': p.muted,
    skeleton: `color-mix(in srgb, ${p.fg} 4%, transparent)`,
    'skeleton-shine': `color-mix(in srgb, ${p.fg} 8%, transparent)`,
    'err-fg': p.red, 'err-bg': `color-mix(in srgb, ${p.red} 12%, transparent)`,
    'err-border': `color-mix(in srgb, ${p.red} 35%, transparent)`,
    'color-h1': p.blue, 'color-h2': p.purple, 'color-h3': p.green, 'color-h4': p.cyan,
    'color-h5': p.yellow, 'color-h6': p.muted,
    'color-note': p.blue, 'color-tip': p.green, 'color-important': p.purple,
    'color-warning': p.yellow, 'color-caution': p.red,
    'user-bg': `color-mix(in srgb, ${p.purple} 8%, transparent)`,
    'diff-add': p.green, 'diff-mod': p.yellow, 'diff-del': p.red,
  }
  return Object.entries(v).map(([k, val]) => `--${k}:${val};`).join('')
}

// The page's theme.css: the chosen palette and its counterpart under the page's
// data-theme modes, the configured name and mode for the page to start from,
// and the inline-code and bold colors.
export function themeCss(options: { theme?: unknown; inlineCodeColor?: unknown; strongColor?: unknown }): string {
  const name = typeof options.theme === 'string' && (THEMES[options.theme] || VARIANTS[options.theme])
    ? options.theme
    : DEFAULT_THEME
  const main = THEMES[name]
  const variant = VARIANTS[name]
  const pair = main && THEMES[main.pair]!
  const dark = main?.mode === 'dark' ? main : pair
  const light = main?.mode === 'light' ? main : pair
  const inline = safeColor(options.inlineCodeColor)
  const strong = safeColor(options.strongColor)
  return [
    `/* generated by convo-preview from its settings: theme ${name} */`,
    `:root{--configured-theme:${name};${main || variant ? `--configured-mode:${(main ?? variant)!.mode};` : ''}}`,
    dark ? `:root,[data-theme="dark"]{${vars(dark)}}` : '',
    light ? `[data-theme="light"]{${vars(light)}}` : '',
    variant
      ? `[data-theme="${variant.mode}"]{${Object.entries(variant.vars).map(([k, v]) => `--${k}:${v};`).join('')}}`
      : '',
    inline ? `:root{--inline-code:${inline};}` : '',
    strong ? `:root{--strong:${strong};}` : '',
    '',
  ].join('\n')
}
