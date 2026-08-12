import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveClaudePath } from './claudeDir'

/**
 * The app the notifications come from.
 *
 * `osascript -e 'display notification …'` posts as Script Editor, because that
 * is the application AppleScript is running inside. The banner therefore wears
 * Script Editor's icon and — the part that made this worth fixing — clicking it
 * opens Script Editor, on an empty window, having thrown away the one thing the
 * banner was for: taking you to the session that needs you.
 *
 * A notification belongs to a bundle, so to own the notification we need a
 * bundle. This builds a tiny one: an AppleScript applet that does two things,
 * told apart by whether there is anything in its queue.
 *
 *   posting — a file appears in `Resources/pending`, we launch the applet, it
 *   shows the banner and remembers where that banner points.
 *
 *   clicking — macOS launches the applet with nothing pending, which only
 *   happens when someone clicked the banner, so it opens the remembered link.
 *
 * That indirection is forced: AppleScript has no notification callback, and the
 * click arrives as a plain launch with no argument saying which banner it was.
 * The consequence is that clicking an older banner opens the newest link, which
 * is wrong about as often as two notifications are unread at once — and never
 * worse than the Script Editor window it replaces.
 *
 * Everything here is best-effort. `notify` falls back to `osascript` if any of
 * it fails, because a banner from the wrong app still beats no banner.
 */

const execFileAsync = promisify(execFile)

/** Shown in the banner, in Notification Center, and in its settings pane. */
export const NOTIFIER_APP_NAME = 'Agents Studio'

/** Ours, so macOS keeps our notification settings apart from Script Editor's. */
export const NOTIFIER_BUNDLE_ID = 'app.agents-studio.notifier'

/**
 * The applet.
 *
 * Text arrives as a file, never as part of the program: the strings are read
 * with `sed`/`tail` and handed to `display notification` as values. A title
 * containing a quote is a title containing a quote, which is not true of the
 * `osascript` path below it.
 *
 * `on reopen` matters as much as `on run`: a click while a copy is still alive
 * is a reopen, and without the handler it would do nothing at all.
 */
export const NOTIFIER_SCRIPT = `-- Built by Agents Studio. Edits are overwritten.
on run
	my drain(my resources())
end run

on reopen
	my drain(my resources())
end reopen

on resources()
	return (POSIX path of (path to me)) & "Contents/Resources/"
end resources

on drain(res)
	set entries to my claim(res)
	if (count of entries) is 0 then
		-- Nothing to say means nobody asked us to say anything, so this launch
		-- is a click on a banner we posted earlier.
		my openTarget(res & "target")
	else
		repeat with e in entries
			my post(res, contents of e)
		end repeat
	end if
end drain

on post(res, entry)
	try
		set theTitle to do shell script "/usr/bin/sed -n 1p " & quoted form of entry
		set theLink to do shell script "/usr/bin/sed -n 2p " & quoted form of entry
		set theBody to do shell script "/usr/bin/tail -n +3 " & quoted form of entry
		do shell script "/bin/rm -f " & quoted form of entry
		do shell script "/bin/echo " & quoted form of theLink & " > " & quoted form of (res & "target")
		display notification theBody with title theTitle
	on error
		-- One unshowable banner is not worth losing the rest of the queue over.
		try
			do shell script "/bin/rm -f " & quoted form of entry
		end try
	end try
end post

-- Renaming is the claim: two copies of the applet can be draining at once, and
-- only one of them can win the move, so nothing is ever shown twice.
on claim(res)
	set out to {}
	try
		set names to paragraphs of (do shell script "/bin/ls -1 " & quoted form of (res & "pending") & " 2>/dev/null")
	on error
		return out
	end try
	repeat with n in names
		set nm to contents of n
		if nm is not "" then
			try
				do shell script "/bin/mv " & quoted form of (res & "pending/" & nm) & " " & quoted form of (res & "claimed-" & nm)
				set end of out to res & "claimed-" & nm
			end try
		end if
	end repeat
	return out
end claim

on openTarget(target)
	try
		set u to do shell script "/bin/cat " & quoted form of target
		if u is not "" then do shell script "/usr/bin/open " & quoted form of u
	end try
end openTarget
`

/**
 * The icon, as the favicon rather than a copy of it: one file to change when
 * the mark changes. Rasterised at build time by Quick Look, which is the only
 * SVG renderer we can count on being installed.
 */
const NOTIFIER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="4" y="8" width="24" height="18" rx="4" fill="#e5a93e"/>
  <circle cx="12" cy="17" r="2" fill="#0a0a0f"/>
  <circle cx="20" cy="17" r="2" fill="#0a0a0f"/>
  <rect x="14" y="2" width="4" height="6" rx="2" fill="#e5a93e"/>
</svg>
`

/**
 * What the bundle on disk was built from, so an upgrade that changes the applet
 * replaces it instead of quietly running the old one forever.
 */
const NOTIFIER_BUILD = createHash('sha256')
  .update([NOTIFIER_SCRIPT, NOTIFIER_ICON_SVG, NOTIFIER_APP_NAME, NOTIFIER_BUNDLE_ID].join(' '))
  .digest('hex')
  .slice(0, 12)

export function notifierAppPath(): string {
  return resolveClaudePath('agents-ui', 'notifier', `${NOTIFIER_APP_NAME}.app`)
}

/**
 * The keys `osacompile` leaves out, which are the keys that matter.
 *
 * Without `CFBundleIdentifier` an applet has no identity of its own and its
 * notifications fall back to Script Editor's — the whole bug, in one missing
 * key. `LSUIElement` keeps the applet out of the Dock and the app switcher,
 * where a thing that lives for half a second has no business appearing.
 *
 * Written by hand rather than with `PlistBuddy` so that what goes into the file
 * is testable without building a bundle first.
 */
export function notifierPlist(xml: string): string {
  const keys: Array<[string, string]> = [
    ['CFBundleIdentifier', `<string>${NOTIFIER_BUNDLE_ID}</string>`],
    ['CFBundleDisplayName', `<string>${NOTIFIER_APP_NAME}</string>`],
    ['CFBundleName', `<string>${NOTIFIER_APP_NAME}</string>`],
    ['LSUIElement', '<true/>'],
  ]

  // A key stated twice is not a plist, so anything already there is left alone.
  const additions = keys
    .filter(([key]) => !xml.includes(`<key>${key}</key>`))
    .map(([key, value]) => `\t<key>${key}</key>\n\t${value}\n`)
    .join('')

  if (!additions) return xml

  const close = xml.lastIndexOf('</dict>')
  if (close === -1) return xml

  return xml.slice(0, close) + additions + xml.slice(close)
}

/**
 * One notification, as the applet reads it: title, where the banner points,
 * then the body — which is the only part allowed to run on.
 */
export function notifierEntry(title: string, link: string, body: string): string {
  const flat = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

  return `${flat(title)}\n${flat(link)}\n${body}\n`
}

/** Best-effort: an applet with the stock scroll icon still notifies correctly. */
async function buildIcon(scratch: string, iconPath: string): Promise<void> {
  try {
    const svg = join(scratch, 'icon.svg')
    await writeFile(svg, NOTIFIER_ICON_SVG, 'utf-8')
    await execFileAsync('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', scratch, svg])
    // 512 is what a banner and Notification Center ask for; `sips` writes a
    // single-representation `.icns`, which is all an applet needs.
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'icns', join(scratch, 'icon.svg.png'), '--out', iconPath])
  } catch {
    // Deliberately swallowed.
  }
}

let building: Promise<string | null> | null = null

/**
 * The bundle, built if it is missing or was built from a different applet.
 *
 * Memoised on the promise rather than the result: several runs can finish at
 * the same second, and building the same bundle four times over would have them
 * renaming a directory out from under each other.
 */
export async function ensureNotifierApp(): Promise<string | null> {
  if (!building) building = build()

  const app = await building
  // A failure is not cached: the next notification tries again, since what
  // stopped it may have been a full disk or a half-installed toolchain.
  if (!app) building = null

  return app
}

async function build(): Promise<string | null> {
  const app = notifierAppPath()

  try {
    const built = await readFile(join(app, 'Contents', 'Resources', 'build'), 'utf-8')
    if (built.trim() === NOTIFIER_BUILD) {
      // `pending` is where the next notification goes, and an interrupted
      // drain can leave it gone.
      await mkdir(join(app, 'Contents', 'Resources', 'pending'), { recursive: true })
      return app
    }
  } catch {
    // Not built, or not readable, which comes to the same thing.
  }

  const dir = resolveClaudePath('agents-ui', 'notifier')
  // Built beside its destination, not in the system temp directory: the last
  // step is a rename, and a rename across volumes is not one.
  const scratch = join(dir, `.build-${process.pid}`)

  try {
    await rm(scratch, { recursive: true, force: true })
    await mkdir(scratch, { recursive: true })

    const source = join(scratch, 'notifier.applescript')
    await writeFile(source, NOTIFIER_SCRIPT, 'utf-8')

    const staged = join(scratch, `${NOTIFIER_APP_NAME}.app`)
    await execFileAsync('/usr/bin/osacompile', ['-o', staged, source])

    const plist = join(staged, 'Contents', 'Info.plist')
    await writeFile(plist, notifierPlist(await readFile(plist, 'utf-8')), 'utf-8')

    await buildIcon(scratch, join(staged, 'Contents', 'Resources', 'applet.icns'))
    await mkdir(join(staged, 'Contents', 'Resources', 'pending'), { recursive: true })
    await writeFile(join(staged, 'Contents', 'Resources', 'build'), NOTIFIER_BUILD, 'utf-8')

    await rm(app, { recursive: true, force: true })
    await rename(staged, app)

    return app
  } catch {
    return null
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

let sequence = 0

/**
 * How long a queued notification is still worth showing.
 *
 * Launching an app needs a desktop, and there are places this server runs where
 * there is not one — a container, or a login session that has since ended. The
 * launch reports success and nothing ever drains the queue, so without this the
 * first notification on a machine that got a desktop back would arrive as a
 * fortnight of banners at once.
 */
const STALE_MS = 5 * 60_000

/** Names begin with the millisecond they were written, which is what dates them. */
export function stalePendingNames(names: string[], now: number, windowMs = STALE_MS): string[] {
  return names.filter((name) => {
    const written = Number(name.split('-')[0])
    // Unparseable means it was not written by this — sweep it, nothing else will.
    return !Number.isFinite(written) || now - written > windowMs
  })
}

async function prunePending(pending: string): Promise<void> {
  try {
    const names = await readdir(pending)
    await Promise.all(
      stalePendingNames(names, Date.now()).map(name => rm(join(pending, name), { force: true })),
    )
  } catch {
    // Deliberately swallowed: the notification matters more than the sweep.
  }
}

/**
 * Hand one notification to the applet. Throws if it could not be handed over,
 * which is `notify`'s cue to fall back to `osascript`.
 */
export async function postViaNotifier(title: string, body: string, link: string): Promise<void> {
  const app = await ensureNotifierApp()
  if (!app) throw new Error('no notifier app')

  const pending = join(app, 'Contents', 'Resources', 'pending')
  await prunePending(pending)

  // Sorted by `ls`, so the queue drains in the order things happened. The pid
  // keeps two servers on one machine from picking the same name.
  const file = join(pending, `${Date.now()}-${process.pid}-${sequence++}`)
  await writeFile(file, notifierEntry(title, link, body), 'utf-8')

  try {
    // `-n`: a fresh copy every time. Reusing a running one would deliver the
    // launch as a reopen to whichever copy happened to still be draining.
    await execFileAsync('/usr/bin/open', ['-n', '-a', app])
  } catch (e) {
    // Nothing is coming to read it, and `notify` is about to say this another
    // way, so leaving it queued would only show it twice later.
    await rm(file, { force: true })
    throw e
  }
}
