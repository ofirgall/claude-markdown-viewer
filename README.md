# claude-markdown-viewer

<img width="1287" height="998" alt="file-8cead5d4d476b97936fed3e944743bd7" src="https://github.com/user-attachments/assets/470890b2-50dd-494c-96f5-665753d4afe2" />

A Claude Code mod that shows the current conversation as a live Markdown page in your browser. Its look is adapted from [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview).

After every tool call and at the end of every turn, the mod writes the conversation to `~/.claude/markdown-preview/<session-id>/` (as `conversation.md`, and as `data.js` for the page). The page is opened straight from that folder as a `file://` page, with no server: it reloads `data.js` every second and re-renders when the conversation changes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install markdown-preview --marketplace ofirgall/claude-markdown-viewer
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install markdown-preview --marketplace ofirgall/claude-markdown-viewer
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ofirgall/claude-markdown-viewer`, then **Add plugin**.

Requirements:
- macOS for `/markdown` to open the browser itself (it uses `open`). On other systems, open the address `/markdown` prints yourself.
- Internet access in the browser: the page loads marked, DOMPurify, highlight.js and mermaid from CDNs.

## Use

- The page's title is the conversation's (its `/rename` title, else the one Claude Code generated). Beside it: the workspace, the git branch (linked to the repository), the branch's pull request when `gh` finds one, and the conversation's id (click to copy).
- `/markdown` opens the page in your browser.
- Diagrams pan and zoom: drag to pan, Ctrl/⌘ + scroll (or pinch) over a diagram to zoom at the pointer, the corner buttons to zoom or reset. ⛶ or a double-click opens a diagram full screen in a floating panel, where plain scrolling zooms: ‹ › or ←/→ step through the turn's diagrams, and Esc, ✕, a double-click or a click outside closes it.

The page shows one turn (a prompt and Claude's answer to it) at a time. That keeps it fast in long sessions: only the turn on screen is rendered, and it is re-rendered only when that turn changes. Each turn has previous / next buttons at its top and bottom, and the address ends in `#turn-N`, so a reload or a link opens the same turn.

On the page:

| Key | Action |
| --- | --- |
| `t` | Turns sidebar (one entry per prompt; click to open that turn) |
| `/` or `Ctrl+F` | Search the turn on screen, or every turn with "All turns" (`Alt+A`). The Prompts, Responses, Tools, Code and Diagrams boxes (`Alt+P`, `Alt+R`, `Alt+T`, `Alt+C`, `Alt+D`) include or leave out your prompts, Claude's replies, tool calls, code blocks and diagrams (matched by their source) |
| `f` | Follow: stay on the newest turn, scrolled to its end |
| `e` | Expand or collapse all tool calls |
| `w` | Cycle the content width: 50% → 70% → 95% (hover the ↔ button for a 50–100% slider) |
| `r` | Refresh the page |
| `j` / `k` (or `l` / `h`) | Next / previous turn |
| `]` / `[` | Next / previous code block in the turn |
| `}` / `{` | Next / previous diagram in the turn |
| `g` / `G` | Top of the turn / newest turn's end |

- Two or more tool calls in a row fold into one "N tool calls" group. Opening it shows each call, with its input and output, as its own collapsible block.
- The sticky footer shows your position among turns, and among the code blocks and diagrams of the turn on screen, with buttons to step through them.
- Mermaid code blocks render as diagrams, and `> [!NOTE]`-style alerts render as callout boxes.
- Raw HTML in the conversation is sanitised with DOMPurify before display.
- The page reloads itself when the mod's page files change.

## Theme

Set the mod's options in `/plugin` (Configure), or in `settings.json`:

```json
"pluginConfigs": {
  "markdown-preview@claude-markdown-viewer": {
    "options": {
      "theme": "github",
      "inlineCodeColor": "#cba6f7",
      "strongColor": "#7a9cff"
    }
  }
}
```

| Option | Default | |
| --- | --- | --- |
| `theme` | `github` | `github` (the original look; follows the system's light/dark mode), `github-dark-ofir` (`github` in dark mode with Claude Code's inline code `#cba6f7` and bold `#7a9cff`, and prompts on purple), `catppuccin-mocha`, `catppuccin-latte`, `tokyo-night`, `tokyo-day`, `gruvbox-dark`, `gruvbox-light`, `rose-pine`, `rose-pine-dawn`, `dracula`, `nord`. The page's light/dark button switches to its counterpart. |
| `inlineCodeColor` | theme | Text color of `` `inline code` ``. |
| `strongColor` | theme | Text color of **bold** text. |
| `customCss` | `~/.claude/markdown-preview/custom.css` | A stylesheet loaded after all the others. It is re-read on every update, and the open page reloads when it changes. |

The page's colors are CSS variables (`--bg`, `--fg`, `--code-bg`, `--inline-code`, `--strong`, `--color-h1`…`--color-h6`, see `hooks/themes.ts`), so a custom stylesheet can override a few of them:

```css
:root { --inline-code: #f5c2e7; }
#content h2 { border-bottom: none; }
```

## Develop

```
claude --plugin-dir /path/to/claude-markdown-viewer
claude plugin validate /path/to/claude-markdown-viewer
```

`hooks/register.tsx` is the mod, `hooks/themes.ts` its palettes. `web/` holds the page (`index.html`, `app.css`, `app.js`).

## License

MIT. `web/app.css` and the page layout are adapted from [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview) (MIT).
