import type { EngineInterface, Register, SessionMessage } from 'claude-code'

// Writes the conversation as Markdown to ~/.claude/convo-preview/<session>/
// and serves that folder with a local python http.server; the page in web/
// (styled after github.com/ywsrock/nvim-md-preview) polls and re-renders it.

const COMMAND = 'markdown'
const ASSETS = ['index.html', 'app.css', 'app.js']
const TOOL_TEXT_MAX = 4000
const INPUT_MAX = 2000
const FILE_MAX = 3_800_000 // stay under $.fs.write's 4 MiB

let dir: string | undefined
let url: string | undefined
let lastWritten = ''
let writing: Promise<void> = Promise.resolve()

const fence = (body: string, lang = '') => {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map(s => s.length))
  const f = '`'.repeat(longest + 1)
  return `${f}${lang}\n${body}\n${f}`
}

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more chars)` : s

const clean = (s: string) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?(command-name|command-message|command-args|local-command-stdout)>/g, '')
    .trim()

const oneLine = (s: string, max = 70) => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const toolLabel = (tool: string, input: Record<string, unknown>) => {
  const pick =
    input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ??
    input.description ?? input.skill ?? input.prompt
  return typeof pick === 'string' ? `${tool} — ${oneLine(pick, 80)}` : tool
}

const escapeSummary = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Push a message's own headings below the turn (##) and Claude (###) levels,
// leaving fenced code alone, so the TOC lists only turns.
function demoteHeadings(text: string): string {
  let fence: string | undefined
  return text
    .split('\n')
    .map(line => {
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (open) {
        if (!fence) fence = open
        else if (open[0] === fence[0] && open.length >= fence.length) fence = undefined
        return line
      }
      if (fence) return line
      const h = /^(\s{0,3})(#{1,6})(\s|$)/.exec(line)
      return h ? `${h[1]}${'#'.repeat(Math.min(6, h[2]!.length + 3))}${line.slice(h[0].length - h[3]!.length)}` : line
    })
    .join('\n')
}

function toMarkdown(messages: readonly SessionMessage[], title: string): string {
  const out: string[] = [`# ${title}`, '']
  let turn = 0
  let inAssistant = false

  for (const m of messages) {
    if (m.role === 'user') {
      const text = clean(m.text)
      if (!text) continue // tool results only: shown with their tool use
      turn++
      inAssistant = false
      out.push(`## ${turn}. ${oneLine(text.split('\n')[0] ?? '', 70) || 'User'}`, '', demoteHeadings(text), '')
      continue
    }

    if (!inAssistant) {
      out.push('### Claude', '')
      inAssistant = true
    }
    const text = m.text.trim()
    if (text) out.push(demoteHeadings(text), '')

    for (const t of m.toolUses) {
      const icon = t.isError ? '❌' : t.text === undefined && t.result === undefined ? '⏳' : '🔧'
      out.push(
        `<details class="tool"><summary>${icon} ${escapeSummary(toolLabel(t.tool, t.input))}</summary>`,
        '',
        fence(clip(JSON.stringify(t.input, null, 2), INPUT_MAX), 'json'),
        '',
      )
      const result =
        t.text ?? (t.result === undefined ? undefined : JSON.stringify(t.result, null, 2))
      if (result !== undefined && result.trim()) {
        out.push(fence(clip(result, TOOL_TEXT_MAX)), '')
      }
      out.push('</details>', '')
    }
  }

  let md = out.join('\n')
  if (md.length > FILE_MAX) {
    md = `# ${title}\n\n> [!NOTE]\n> Older messages trimmed to fit.\n\n${md.slice(md.length - FILE_MAX)}`
  }
  return md
}

const hashOf = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// Copy the page's files into the served folder when they changed (edits to
// web/ alone do not reload the module), stamping index.html's links with the
// version so the browser cannot keep a stale copy, and writing version.txt,
// which the open page polls to reload itself.
let assetsVersion = ''
async function syncAssets($: EngineInterface, target: string) {
  const files = await Promise.all(ASSETS.map(name => $.fs.read(`${$.plugin.root}/web/${name}`)))
  const version = hashOf(files.join('\0')).toString(36)
  if (version === assetsVersion) return
  for (const [i, name] of ASSETS.entries()) {
    const text = name === 'index.html'
      ? files[i]!.replace(/(href|src)="(app\.(?:css|js))"/g, `$1="$2?v=${version}"`)
      : files[i]!
    await $.fs.write(`${target}/${name}`, text)
  }
  await $.fs.write(`${target}/version.txt`, version)
  assetsVersion = version
}

async function refresh($: EngineInterface) {
  if (!dir) return
  const target = dir
  writing = writing.then(async () => {
    await syncAssets($, target)
    const [messages, cwd] = await Promise.all([$.session.messages(), $.session.cwd()])
    const name = cwd.split('/').filter(Boolean).at(-1) ?? cwd
    const md = toMarkdown(messages, `Conversation · ${name}`)
    if (md === lastWritten) return
    await $.fs.write(`${target}/conversation.md`, md)
    lastWritten = md
  }).catch(err => $.ui.log(`convo-preview: write failed: ${String(err)}`, { to: 'debug' }))
  await writing
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: COMMAND,
      description: 'Open the live Markdown preview of this conversation in the browser',
    })

    const [{ stdout: home }, id] = await Promise.all([
      $.process.run(['printenv', 'HOME']),
      $.session.id(),
    ])
    dir = `${home.trim()}/.claude/convo-preview/${id}`
    lastWritten = ''
    assetsVersion = ''

    await syncAssets($, dir)
    await $.fs.write(`${dir}/conversation.md`, '# Conversation\n\n_Waiting for the first turn…_\n')
    void refresh($)

    // A port fixed per session, so the URL (and the page's saved settings,
    // which are per origin) survive reloads. Right after a reload the old
    // server may still hold it for a moment: retry, then fall back to any port.
    const preferred = 40000 + (hashOf(id) % 20000)
    const servedDir = dir

    // The server lives as long as this loop: the session, or until a reload.
    void (async () => {
      for (const port of [preferred, preferred, preferred, preferred, 0]) {
        let bound = false
        try {
          const server = $.process.spawn({
            argv: ['python3', '-u', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', servedDir],
          })
          for await (const piece of server) {
            if (!('text' in piece) || bound) continue
            const found = /port (\d+)/.exec(piece.text)?.[1]
            if (found) {
              bound = true
              url = `http://127.0.0.1:${found}/`
              $.ui.status(`📄 ${url}`)
            }
          }
        } catch (err) {
          $.ui.log(`convo-preview: server failed: ${String(err)}`, { to: 'debug' })
        }
        if (bound) break // it ran and then ended: the module unloaded or it died
        await $.clock.sleep(500)
      }
      url = undefined
      $.ui.status(undefined)
    })()

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    if (!url) return { text: 'convo-preview: the preview server is not running yet.' }
    await refresh($)
    await $.process.run(['open', url])
    return { text: `Opened ${url}` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) void refresh($)
    return done
  })
}
