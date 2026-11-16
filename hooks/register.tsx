import type { EngineInterface, PluginOptions, Register, SessionMessage } from 'claude-code'
import { themeCss } from './themes'

// Writes the conversation as Markdown to ~/.claude/markdown-preview/<session>/
// and serves that folder with a local python http.server; the page in web/
// (styled after github.com/ywsrock/nvim-md-preview) polls and re-renders it.

const COMMAND = 'markdown'
const ASSETS = ['index.html', 'app.css', 'app.js']
const TOOL_TEXT_MAX = 4000
const INPUT_MAX = 2000
const FILE_MAX = 3_800_000 // stay under $.fs.write's 4 MiB
const URL_COLOR = '#c4b5fd' // light, calm purple

let dir: string | undefined
let url: string | undefined
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
// version so the browser cannot keep a stale copy, and writing version.txt,
// which the open page polls to reload itself.
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
  await $.fs.write(`${target}/version.txt`, version)
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
let lastMeta = ''
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
    const metaText = JSON.stringify(info)
    if (metaText !== lastMeta) {
      await $.fs.write(`${target}/meta.json`, metaText)
      lastMeta = metaText
    }
    const name = cwd.split('/').filter(Boolean).at(-1) ?? cwd
    const md = toMarkdown(messages, info.title || `Conversation · ${name}`)
    if (md === lastWritten) return
    await $.fs.write(`${target}/conversation.md`, md)
    lastWritten = md
  }).catch(err => $.ui.log(`markdown-preview: write failed: ${String(err)}`, { to: 'debug' }))
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
              $.ui.invalidate('ui.render')
            }
          }
        } catch (err) {
          $.ui.log(`markdown-preview: server failed: ${String(err)}`, { to: 'debug' })
        }
        if (bound) break // it ran and then ended: the module unloaded or it died
        await $.clock.sleep(500)
      }
      url = undefined
      $.ui.invalidate('ui.render')
    })()

    return started
  })

  // The preview's address at the end of the hint line under the prompt, in a
  // calm purple (a $.ui.status line is drawn as a notice, which it is not).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = await next(e)
    if (!url) return line
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {line}
        <Text color={URL_COLOR}>{'  '}markdown: {url}</Text>
      </Box>
    )
  })

  on('command.run', { command: COMMAND }, async $ => {
    if (!url) return { text: 'markdown-preview: the preview server is not running yet.' }
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
