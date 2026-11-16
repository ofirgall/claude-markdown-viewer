# claude-markdown-viewer

A Claude Code mod that shows the current conversation as a live Markdown page in your browser. Its look is adapted from [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview).

After every tool call and at the end of every turn, the mod writes the conversation to `~/.claude/convo-preview/<session-id>/conversation.md`. It serves that folder on `127.0.0.1` with a small `python3 -m http.server`. The page checks the file every second and re-renders when it changes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install convo-preview --marketplace ofirgall/claude-markdown-viewer
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install convo-preview --marketplace ofirgall/claude-markdown-viewer
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ofirgall/claude-markdown-viewer`, then **Add plugin**.

Requirements:
- `python3` on your PATH.
- macOS for `/markdown` to open the browser itself (it uses `open`). On other systems, open the URL from the status line yourself.
- Internet access in the browser: the page loads marked, DOMPurify, highlight.js and mermaid from CDNs.

## Use

- The status line shows the preview's address, `📄 http://127.0.0.1:<port>/`. The port is fixed for each session.
- `/markdown` opens the page in your browser.

The page shows one turn (a prompt and Claude's answer to it) at a time. That keeps it fast in long sessions: only the turn on screen is rendered, and it is re-rendered only when that turn changes. Each turn has previous / next buttons at its top and bottom, and the address ends in `#turn-N`, so a reload or a link opens the same turn.

On the page:

| Key | Action |
| --- | --- |
| `t` | Turns sidebar (one entry per prompt; click to open that turn) |
| `/` or `Ctrl+F` | Search the turn on screen |
| `f` | Follow: stay on the newest turn, scrolled to its end |
| `e` | Expand or collapse all tool calls |
| `w` | Cycle the content width: 50% → 70% → 95% (hover the ↔ button for a 50–100% slider) |
| `j` / `k` (or `l` / `h`) | Next / previous turn |
| `]` / `[` | Next / previous code block in the turn |
| `}` / `{` | Next / previous diagram in the turn |
| `g` / `G` | Top of the turn / newest turn's end |

- Two or more tool calls in a row fold into one "N tool calls" group. Opening it shows each call, with its input and output, as its own collapsible block.
- The sticky footer shows your position among turns, and among the code blocks and diagrams of the turn on screen, with buttons to step through them.
- Mermaid code blocks render as diagrams, and `> [!NOTE]`-style alerts render as callout boxes.
- Raw HTML in the conversation is sanitised with DOMPurify before display.
- The page reloads itself when the mod's page files change.

## Develop

```
claude --plugin-dir /path/to/claude-markdown-viewer
claude plugin validate /path/to/claude-markdown-viewer
```

`hooks/register.ts` is the mod. `web/` holds the page (`index.html`, `app.css`, `app.js`).

## License

MIT. `web/app.css` and the page layout are adapted from [nvim-md-preview](https://github.com/ywsrock/nvim-md-preview) (MIT).
