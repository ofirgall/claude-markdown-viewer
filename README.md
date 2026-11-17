# claude-markdown-viewer

<img width="1287" height="998" alt="file-8cead5d4d476b97936fed3e944743bd7" src="https://github.com/user-attachments/assets/470890b2-50dd-494c-96f5-665753d4afe2" />

A Claude Code mod that shows the current conversation as a live Markdown page in your browser, styled after [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview). Run `/markdown` to open it.

## Install

```
/plugin install markdown-preview --marketplace ofirgall/claude-markdown-viewer
```

Or from a shell: `claude plugin install markdown-preview --marketplace ofirgall/claude-markdown-viewer`. In the desktop app: **+** → **Plugins** → **Add marketplace** `ofirgall/claude-markdown-viewer` → **Add plugin**.

`/markdown` opens the browser with macOS `open`; elsewhere, open the address it prints. The page loads its libraries (marked, DOMPurify, highlight.js, mermaid) from CDNs.

## Use

The page shows one turn (a prompt and its answer) at a time, live as it grows. It opens at the top of the newest turn so you read it top to bottom; scrolling to its end (or `f`) follows it as it grows. The header has the conversation's title, workspace, git branch, pull request and id.

- **Diagrams:** each is titled by the closest heading above it. Drag to pan, Ctrl/⌘ + scroll or pinch to zoom. ⛶ or a double-click opens one full screen, where ‹ › or ←/→ step through the turn's diagrams. Colors a diagram picked for the other theme are toned down so its text stays readable.
- **Tool calls** in a row fold into one group; each call opens to its input and output.
- **Long prompts** collapse after 4 lines behind "Read more".
- **Edited files:** the files Claude edited in the turn on screen are in a right panel. Hover the window's right edge or the header's file button to open it; click the button or press `F` to keep it open. Markdown files open rendered in the page, live as Claude edits them.

| Key | Action |
| --- | --- |
| `t` | Turns sidebar |
| `/`, `Ctrl+F` | Search this turn or all turns (`Alt+A`); filter prompts, responses, tools, code, diagrams (`Alt+P/R/T/C/D`) |
| `j` / `k` | Next / previous turn |
| `]` / `[`, `}` / `{` | Next / previous code block, diagram |
| `g` / `G` | Top of the turn / newest turn's end |
| `f` | Follow the newest turn |
| `e` | Expand or collapse all tool calls |
| `w` | Content width 50 / 70 / 95% |
| `F` | Pin the edited-files panel |
| `r` | Refresh |

## Options

Set in `/plugin` (Configure), or in `settings.json`:

```json
"pluginConfigs": {
  "markdown-preview@claude-markdown-viewer": {
    "options": { "theme": "github-dark-ofir" }
  }
}
```

| Option | Default | |
| --- | --- | --- |
| `theme` | `github` | `github`, `github-dark-ofir`, `catppuccin-mocha`/`-latte`, `tokyo-night`/`-day`, `gruvbox-dark`/`-light`, `rose-pine`/`-dawn`, `dracula`, `nord` |
| `inlineCodeColor` | theme | Color of `` `inline code` `` |
| `strongColor` | theme | Color of **bold** |
| `customCss` | `~/.claude/markdown-preview/custom.css` | A stylesheet loaded last; it can override the theme's CSS variables (see `hooks/themes.ts`) |

## How it works

On every tool call and turn end, the mod writes the conversation to `~/.claude/markdown-preview/<session-id>/data.js`, and copies the Markdown files Claude edited next to it. The page is opened from that folder as a `file://` page, with no server, and reloads `data.js` every second.

## Develop

```
claude --plugin-dir /path/to/claude-markdown-viewer
claude plugin validate /path/to/claude-markdown-viewer
```

`hooks/register.tsx` is the mod, `hooks/themes.ts` its palettes, and `web/` the page.

## License

MIT. The page's layout and styles are adapted from [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview) (MIT).
