import { basename } from 'node:path'
import { mapLimit } from './pool'
import { readProjects, type Project } from './projects'
import { readPulls, type DecoratedPull } from './reviews'
import type { WallPull, WallPullProblem, WallPullsReading, WallPullsSummary } from '~/utils/wall'

/**
 * Every pull request with your name on it, across every project on this machine.
 *
 * `/api/github/pulls` answers the same question for *one* repository — the one
 * selected in the sidebar — and that is right for the reviews page, which is a
 * page about the project you are in. It is wrong for the wall: somebody watching
 * four repositories has review requests in all four, and a screen that shows the
 * ones in whichever repository happens to be selected is a screen that hides
 * three quarters of what is waiting while looking complete.
 *
 * **Why this is cached and the rest of the wall is not.** `/api/wall` is built
 * without spawning a process, which is what lets it be polled every couple of
 * seconds forever. This is the opposite: `readPulls` is four `gh` calls and a
 * GraphQL query *per repository*, roughly a second each, and it leaves the
 * machine. At the wall's poll rate across four projects that would be a hundred
 * subprocesses a minute and somebody's GitHub rate limit spent on a badge.
 *
 * So it is read at most once a minute and held, and every reader gets the same
 * reading. A review request that arrives while you are inside something else can
 * be a minute late; the screen stamps how old it is, which is the part that
 * matters — see `asOfLabel`. Nothing is invented in between.
 *
 * **A repository that cannot be read says so.** An empty list is news and a
 * failed read is not, and the two must never look the same: `problems` carries
 * the reason per project, exactly as `readPulls` does for one. This is the same
 * rule the reviews page has, applied across a set.
 */

/**
 * How long a reading stands.
 *
 * A minute is chosen against what the figures actually do: a review is requested
 * a few times a day, CI turns red once per push. Both are minutes-apart events,
 * and a wall that is up to sixty seconds behind on either is not wrong in a way
 * anybody could act on. Halving it would double the cost to change nothing.
 */
const TTL_MS = 60_000

/**
 * Repositories read at once.
 *
 * Lower than the wall's own eight because each of these is `gh` talking to
 * github.com rather than a file read — the limit that matters is somebody's API
 * rate, not this machine's disk.
 */
const AT_ONCE = 3

let cached: WallPullsReading | null = null

/**
 * The sweep in flight, so a second caller joins it rather than starting another.
 *
 * The wall polls this, and so would any other screen left open beside it. Two
 * sweeps running at once would be eight `gh` processes doing identical work and
 * two answers racing to be the cached one.
 */
let sweeping: Promise<WallPullsReading> | null = null

export async function readWallPulls(options: { force?: boolean } = {}): Promise<WallPullsReading> {
  if (cached && !options.force && Date.now() - cached.at < TTL_MS) return cached
  if (sweeping) return sweeping

  sweeping = sweep().finally(() => { sweeping = null })
  return sweeping
}

async function sweep(): Promise<WallPullsReading> {
  const projects = await readProjects()

  const readings = await mapLimit(projects, AT_ONCE, async project => ({
    project,
    // `readPulls` already turns every expected failure into `ok: false` with a
    // reason. This catch is for the unexpected one, and it still produces a
    // problem rather than an absence.
    reading: await readPulls(project.path).catch(() => null),
  }))

  const reviewing: WallPull[] = []
  const mine: WallPull[] = []
  const problems: WallPullProblem[] = []
  let repos = 0
  let skipped = 0

  /**
   * Pull requests already carried, by URL.
   *
   * The same GitHub repository can be registered twice on one machine — a second
   * checkout, or a worktree added as a project of its own — and it would
   * otherwise contribute its whole list twice. The URL is the only identity that
   * survives that, since the number is only unique within a repository.
   */
  const seen = new Set<string>()

  for (const { project, reading } of readings) {
    if (!reading) {
      problems.push({ repo: nameOf(project), reason: 'Its pull requests could not be read.' })
      continue
    }

    if (!reading.ok) {
      /**
       * A folder that is not a GitHub project is not a fault, and reporting it as
       * one would put a permanent warning on the screen about a state nobody
       * intends to change. Most machines running this have at least one — a notes
       * directory, a workspace root — and a panel that warns about them every
       * minute is a panel whose warnings stop being read.
       *
       * Everything else *is* worth saying: `gh` not signed in, or GitHub not
       * answering, means the empty list below is unknown rather than empty.
       */
      if (reading.refusal === 'not-github' || reading.refusal === 'no-project') skipped++
      else problems.push({ repo: nameOf(project), reason: reading.reason ?? 'GitHub could not be asked.' })
      continue
    }

    repos++

    for (const pull of reading.reviewing) {
      if (seen.has(pull.url)) continue
      seen.add(pull.url)
      reviewing.push(flatten(pull, project))
    }

    for (const pull of reading.mine) {
      if (seen.has(pull.url)) continue
      seen.add(pull.url)
      mine.push(flatten(pull, project))
    }
  }

  cached = { at: Date.now(), repos, skipped, problems, reviewing, mine, summary: summarizeWallPulls(reviewing, mine) }
  return cached
}

function nameOf(project: Project): string {
  return project.name || basename(project.path) || project.path
}

/**
 * One pull request, with the verdict the reviews page already decided.
 *
 * Not recomputed here, and this is the line that keeps the two screens honest:
 * `verdictFor` is a set of judgement calls about which of six facts outranks the
 * others, and a second implementation of it would drift from the first inside a
 * month. The wall draws what it is handed.
 *
 * Assigning `pull.verdict.state` — the server's `PullState` — into `WallPull`'s
 * `WallPullState` is what makes that mirror safe: if the states ever diverge this
 * line stops compiling.
 */
function flatten(pull: DecoratedPull, project: Project): WallPull {
  return {
    repo: nameOf(project),
    repoDir: project.path,
    headBranch: pull.headBranch,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    author: pull.author,
    mine: pull.mine,
    draft: pull.draft,
    state: pull.verdict.state,
    label: pull.verdict.label,
    detail: pull.verdict.detail,
    onYou: pull.verdict.onYou,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    changedFiles: pull.changedFiles,
    checks: pull.checks,
    unresolved: pull.unresolved,
    awaiting: pull.awaiting.map(reviewer => reviewer.name),
  }
}

/**
 * The counts the header states, derived from the same verdicts the rows draw.
 *
 * `summarizePulls` in `reviews.ts` answers this for one repository and is not
 * reused, for one reason: it takes the two lists of a single reading and
 * recomputes each verdict from the pull request. By here the verdicts are already
 * decided and flattened, and calling back into the undecorated version would mean
 * carrying the raw shape around solely to have it judged a second time.
 */
export function summarizeWallPulls(reviewing: WallPull[], mine: WallPull[]): WallPullsSummary {
  return {
    onYou: [...reviewing, ...mine].filter(pull => pull.onYou).length,
    toReview: reviewing.length,
    toMerge: mine.filter(pull => pull.state === 'ready').length,
    waiting: mine.filter(pull => !pull.onYou).length,
    failing: mine.filter(pull => pull.state === 'checks-failing').length,
  }
}
