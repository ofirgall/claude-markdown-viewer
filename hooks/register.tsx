import type { EngineInterface, PluginOptions, Register, SessionMessage } from 'claude-code'
import { themeCss } from './themes'

// Writes the conversation as Markdown to ~/.claude/markdown-preview/<session>/,
// along with data.js, which the page in web/ (styled after
// github.com/ywsrock/nvim-md-preview), opened as a file:// page, reloads every
// second and re-renders. A file:// page can't fetch() files but can load
// scripts, so no server is needed.

const COMMAND = 'markdown'
const ASSETS = ['index.html', 'app.css', 'app.js']
const TOOL_TEXT_MAX = 4000
const INPUT_MAX = 2000
const FILE_MAX = 3_500_000 // data.js escapes it as JSON: stay under $.fs.write's 4 MiB

let dir: string | undefined
let url: string | undefined // the page, as a file:// URL
let lastWritten = ''
let writing: Promise<void> = Promise.resolve()
let home = ''
let settings: PluginOptions = {}

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

  for (const m of messages) {
    if (m.role === 'user') {
      const text = clean(m.text)
      if (!text) continue // tool results only: shown with their tool use
      turn++
      // The heading splits turns and names them in the turn list; the page
      // hides it and shows the prompt itself, in a block of its own.
      out.push(
        // the whole prompt on one line: the page cuts it where its box ends
        `## ${turn}. ${oneLine(text, 400) || 'User'}`,
        '',
        '<div class="user-prompt">',
        '',
        demoteHeadings(text),
        '',
        '</div>',
        '',
      )
      continue
    }

    const text = m.text.trim()
    // each of Claude's messages in a block the page marks with a bullet, as Claude Code does
    if (text) out.push('<div class="assistant-msg">', '', demoteHeadings(text), '', '</div>', '')

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

// ---- the files Claude changed: each with the turns that changed it. The
// page lists them, and opens the Markdown ones from copies the mod keeps in
// files/<hash>.js (a file:// page can load scripts, not read files).
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MD_FILE = /\.(md|markdown|mdx)$/i
const COPY_MAX = 2_000_000
type EditedFile = { path: string; turns: number[]; edits: number; isMarkdown: boolean; copy?: string }

function editedFiles(messages: readonly SessionMessage[]): EditedFile[] {
  const files = new Map<string, EditedFile>()
  let turn = 0
  for (const m of messages) {
    if (m.role === 'user') {
      if (clean(m.text)) turn++
      continue
    }
    for (const t of m.toolUses) {
      if (!EDIT_TOOLS.has(t.tool) || t.isError) continue
      const path = t.input.file_path ?? t.input.notebook_path
      if (typeof path !== 'string' || !path) continue
      const f = files.get(path) ?? { path, turns: [], edits: 0, isMarkdown: MD_FILE.test(path) }
      f.edits++
      if (f.turns.at(-1) !== turn) f.turns.push(turn)
      files.set(path, f)
    }
  }
  return [...files.values()]
}

// Copy each edited Markdown file the page may open, when its text changed.
const copied = new Map<string, string>()
async function copyMarkdown($: EngineInterface, target: string, files: EditedFile[]) {
  for (const f of files) {
    if (!f.isMarkdown) continue
    const name = `files/${hashOf(f.path).toString(36)}.js`
    const text = await $.fs.read(f.path).catch(() => undefined)
    if (text === undefined || text.length > COPY_MAX) continue
    f.copy = name
    const stamp = `${hashOf(text)}:${text.length}`
    if (copied.get(f.path) === stamp) continue
    await $.fs.write(`${target}/${name}`, `window.__mdpFile(${JSON.stringify({ path: f.path, md: text })});\n`)
    copied.set(f.path, stamp)
  }
}

const hashOf = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// The user's own stylesheet, read fresh each sync so edits to it show up;
// empty when there is none.
async function customCss($: EngineInterface): Promise<string> {
  const set = typeof settings.customCss === 'string' ? settings.customCss.trim() : ''
  const path = set ? set.replace(/^~(?=\/)/, home) : `${home}/.claude/markdown-preview/custom.css`
  try {
    return await $.fs.read(path)
  } catch {
    return set ? `/* markdown-preview: could not read ${path.replace(/\*\//g, '')} */\n` : ''
  }
}

// Copy the page's files into the served folder when they changed (edits to
// web/ alone do not reload the module), along with theme.css from the mod's
// settings and the user's custom.css, stamping index.html's links with the
// version so the browser cannot keep a stale copy. data.js carries the
// version too, so an open page reloads itself when it changes.
let assetsVersion = ''
async function syncAssets($: EngineInterface, target: string) {
  const files = await Promise.all(ASSETS.map(name => $.fs.read(`${$.plugin.root}/web/${name}`)))
  const extra: Record<string, string> = {
    'theme.css': themeCss(settings),
    'custom.css': await customCss($),
  }
  const version = hashOf([...files, ...Object.values(extra)].join('\0')).toString(36)
  if (version === assetsVersion) return
  for (const [i, name] of ASSETS.entries()) {
    const text = name === 'index.html'
      ? files[i]!.replace(/(href|src)="((?:app|theme|custom)\.(?:css|js))"/g, `$1="$2?v=${version}"`)
      : files[i]!
    await $.fs.write(`${target}/${name}`, text)
  }
  for (const [name, text] of Object.entries(extra)) await $.fs.write(`${target}/${name}`, text)
  assetsVersion = version
}

// ---- the conversation's details for the page's header: its title, id,
// workspace, git branch and the branch's pull request.
type Meta = {
  title: string | null
  id: string
  workspace: string
  branch: string | null
  repoUrl: string | null
  pr: { number: number; title: string; url: string; state: string } | null
}
let transcript: string | null | undefined // the session's .jsonl, once found
let meta: Meta | undefined
let metaAt = 0
let prKey = '' // branch the PR was looked up for, and when
let prAt = 0
let lastMd = ''
const META_MS = 5_000
const PR_MS = 120_000

async function findTranscript($: EngineInterface, id: string): Promise<string | null> {
  const { stdout } = await $.process.run(['printenv', 'CLAUDE_CONFIG_DIR']).catch(() => ({ stdout: '' }))
  const config = stdout.trim() || `${home}/.claude`
  const found = await $.process.run(['find', `${config}/projects`, '-maxdepth', '2', '-name', `${id}.jsonl`])
    .catch(() => ({ stdout: '' }))
  return found.stdout.split('\n').find(Boolean) ?? null
}

// The title Claude Code shows for the session: one set with /rename, else
// the one it generated. Both are lines in the transcript, the latest winning.
async function readTitle($: EngineInterface, id: string): Promise<string | null> {
  if (transcript === undefined) transcript = await findTranscript($, id)
  if (!transcript) return null
  const { stdout } = await $.process.run(['grep', '-E', '"type":"(custom-title|ai-title)"', transcript])
    .catch(() => ({ stdout: '' }))
  let custom: string | null = null
  let ai: string | null = null
  for (const line of stdout.split('\n')) {
    if (!line) continue
    try {
      const row = JSON.parse(line) as { type?: string; customTitle?: string; aiTitle?: string; title?: string }
      if (row.type === 'custom-title') custom = row.customTitle ?? row.title ?? custom
      else if (row.type === 'ai-title') ai = row.aiTitle ?? row.title ?? ai
    } catch { /* a line cut short: skip it */ }
  }
  return custom || ai
}

// owner/name's web address from an origin URL (https or ssh), for GitHub-like hosts
const webUrl = (remote: string | null) => {
  const m = remote && /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `https://${m[1]}/${m[2]}` : null
}

async function readMeta($: EngineInterface): Promise<Meta> {
  const now = await $.clock.now()
  if (meta && now - metaAt < META_MS) return meta
  const [id, cwd, repo] = await Promise.all([$.session.id(), $.session.cwd(), $.session.repo().catch(() => null)])
  const [title, branchOut] = await Promise.all([
    readTitle($, id),
    $.process.run(['git', '-C', cwd, 'symbolic-ref', '--short', '-q', 'HEAD']).catch(() => ({ stdout: '' })),
  ])
  const branch = branchOut.stdout.trim() || null
  let pr = meta?.pr ?? null
  const key = `${cwd}\n${branch}`
  if (branch && (key !== prKey || now - prAt > PR_MS)) {
    prKey = key
    prAt = now
    const out = await $.process.run(['gh', 'pr', 'view', branch, '--json', 'number,title,url,state'], { cwd, timeoutMs: 15_000 })
      .catch(() => ({ stdout: '' }))
    try { pr = out.stdout.trim() ? JSON.parse(out.stdout) : null } catch { pr = null }
  } else if (!branch) pr = null
  meta = {
    title, id,
    workspace: cwd.startsWith(home + '/') ? `~${cwd.slice(home.length)}` : cwd,
    branch, repoUrl: webUrl(repo?.remote ?? null), pr,
  }
  metaAt = now
  return meta
}

async function refresh($: EngineInterface) {
  if (!dir) return
  const target = dir
  writing = writing.then(async () => {
    await syncAssets($, target)
    const [messages, cwd, info] = await Promise.all([$.session.messages(), $.session.cwd(), readMeta($)])
    const name = cwd.split('/').filter(Boolean).at(-1) ?? cwd
    const md = toMarkdown(messages, info.title || `Conversation · ${name}`)
    const files = editedFiles(messages)
    await copyMarkdown($, target, files)
    const data = `window.__mdpData(${JSON.stringify({ version: assetsVersion, meta: info, md, files, home })});\n`
    if (data === lastWritten) return
    await $.fs.write(`${target}/data.js`, data)
    if (md !== lastMd) await $.fs.write(`${target}/conversation.md`, md)
    lastWritten = data
    lastMd = md
  }).catch(err => $.ui.log(`write failed: ${String(err)}`, { to: 'debug' }))
  await writing
}

export const register: Register = (on, options) => {
  settings = options ?? {}
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: COMMAND,
      description: 'Open the live Markdown preview of this conversation in the browser',
    })

    const [{ stdout }, id] = await Promise.all([
      $.process.run(['printenv', 'HOME']),
      $.session.id(),
    ])
    home = stdout.trim()
    dir = `${home}/.claude/markdown-preview/${id}`
    lastWritten = ''
    lastMd = ''
    copied.clear()
    assetsVersion = ''
    url = `file://${dir.split('/').map(encodeURIComponent).join('/')}/index.html`

    await syncAssets($, dir)
    void refresh($)

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    if (!url) return { text: 'The preview is not set up yet: try again in a moment.' }
    await refresh($)
    const opened = await $.process.run(['open', url]).then(r => r.exitCode === 0, () => false)
    return { text: opened ? `Opened ${url}` : `Open ${url} in your browser.` }
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
