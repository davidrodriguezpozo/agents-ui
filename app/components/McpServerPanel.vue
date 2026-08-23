<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * The other direction: this app as a tool server, and how to connect to it.
 *
 * The list above this is every server *this app can reach*. This is the inverse —
 * another Claude Code session driving this app — and it shipped reachable only by
 * `curl -s localhost:3000/api/mcp/token`, reading the JSON that came back and
 * pasting it into a file. Every step worked and the whole thing was a wall: a
 * feature reached by a `curl` is a feature for the person who wrote it.
 *
 * So the button is the path, and the copy-paste is the fallback rather than the
 * only way. Three things the panel is careful about:
 *
 *   - **The token is a secret and is shown as one.** Masked until asked for,
 *     copied rather than selected, and never in the same breath as the words
 *     "commit this".
 *   - **The refusals are the interesting content.** A tracked `.mcp.json` cannot
 *     be written to — the entry carries the token — so the panel says that in a
 *     sentence and leaves the manual route right underneath it.
 *   - **It says what it did afterwards**, including the part nobody would think
 *     to check: that the file was excluded from git so the token cannot be
 *     committed later by somebody else's `git add .`.
 */

interface Connection {
  token: string
  path: string
  url: string
  mcpJson: unknown
}

interface Result {
  ok: boolean
  path?: string
  created?: boolean
  replaced?: boolean
  kept?: string[]
  excluded?: boolean
  refusal?: { error: string; message: string }
}

const { projects, active, ensureLoaded } = useProjects()
const toast = useToast()

const connection = ref<Connection | null>(null)
const loading = ref(true)

/**
 * Why the token could not be read *into this page*, when it could not.
 *
 * It is handed out on the loopback interface only, proved from the socket rather
 * than from a header — and a development server sits behind Vite's proxy, which
 * loses the peer address entirely. So on a dev server this always fails, and the
 * first version of this panel showed the raw refusal where the controls should
 * have been.
 *
 * Nothing that matters depends on it: the button writes the file on the server,
 * where the token already is. This only costs the copy-and-paste route, and the
 * file is on disk either way.
 */
const unreadable = ref<string | null>(null)
const revealed = ref(false)
const showJson = ref(false)
const connecting = ref(false)
const result = ref<Result | null>(null)
const repoDir = ref('')

onMounted(async () => {
  await ensureLoaded()
  repoDir.value = active.value?.path ?? projects.value[0]?.path ?? ''

  try {
    connection.value = await $fetch<Connection>('/api/mcp/token')
  } catch (e: any) {
    unreadable.value = e?.data?.data?.message ?? e?.data?.message ?? errorMessage(e)
  } finally {
    loading.value = false
  }
})

const json = computed(() =>
  connection.value ? JSON.stringify(connection.value.mcpJson, null, 2) : '')

/** The token, shown as a secret: enough to recognise, not enough to leak. */
const masked = computed(() => {
  const token = connection.value?.token ?? ''
  return token.length > 10 ? `${token.slice(0, 4)}${'•'.repeat(18)}${token.slice(-4)}` : '•'.repeat(12)
})

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, color: 'success' })
  } catch {
    toast.add({
      title: 'Could not copy it',
      description: 'Your browser refused clipboard access — select it and copy by hand.',
      color: 'warning',
    })
  }
}

async function connect() {
  if (!repoDir.value) return

  connecting.value = true
  result.value = null
  try {
    result.value = await $fetch<Result>('/api/mcp/connect', {
      method: 'POST',
      body: { dir: repoDir.value },
    })

    if (result.value.ok) {
      toast.add({ title: 'Connected', description: `Written into ${result.value.path}`, color: 'success' })
    }
  } catch (e) {
    toast.add({ title: 'Could not connect it', description: errorMessage(e), color: 'error' })
  } finally {
    connecting.value = false
  }
}
</script>

<template>
  <section class="panel">
    <header class="head">
      <div>
        <h3 class="type-strong text-body">Let another Claude Code drive this app</h3>
        <p class="type-meta">
          This app is a tool server as well as a client. A session in another repository can start
          work here, read the standing brief and list what is blocked — over loopback, behind a
          token that never leaves this machine.
        </p>
      </div>
    </header>

    <p v-if="loading" class="type-meta">Reading the token…</p>

    <template v-else>
      <!-- The path: one press, no JSON. -->
      <div class="row">
        <select
          v-if="projects.length"
          v-model="repoDir"
          class="text-xs rounded-md px-2 py-1"
          style="background: var(--input-bg); color: var(--text-primary);"
          aria-label="Which project to connect"
        >
          <option v-for="project in projects" :key="project.path" :value="project.path">
            {{ project.name }}
          </option>
        </select>
        <span v-else class="type-meta">Add a project first — the file goes in a repository.</span>
        <UButton
          label="Add it to this project"
          icon="i-lucide-plug"
          size="xs"
          variant="soft"
          :loading="connecting"
          :disabled="!repoDir"
          @click="connect"
        />
      </div>

      <!-- What it did, including the part nobody would think to check. -->
      <p v-if="result?.ok" class="note note--ok">
        {{ result.created ? 'Created' : 'Updated' }} <span class="font-mono">{{ result.path }}</span
        ><template v-if="result.replaced"> — the existing entry was replaced</template>.
        <template v-if="result.kept?.length">
          {{ result.kept.length }} other {{ result.kept.length === 1 ? 'server' : 'servers' }} in it
          {{ result.kept.length === 1 ? 'was' : 'were' }} left alone.
        </template>
        <template v-if="result.excluded">
          It is excluded from git in this clone, so the token cannot be committed by accident.
        </template>
        Open Claude Code in that repository and it will offer to connect.
      </p>

      <!-- The refusals, which are the interesting half. -->
      <p v-else-if="result?.refusal" class="note note--refused">{{ result.refusal.message }}</p>

      <!-- The fallback, always available: it is what the refusals point at. -->
      <div class="manual">
        <button class="disclose" @click="showJson = !showJson">
          {{ showJson ? 'Hide' : 'Or paste it in yourself' }}
        </button>

        <template v-if="showJson">
          <template v-if="connection">
            <p class="type-meta">
              Put this in <span class="font-mono">.mcp.json</span> at the root of the repository you
              want to drive this app from. Keep it out of your commits — it carries the token.
            </p>
            <div class="block">
              <pre>{{ json }}</pre>
              <UButton label="Copy" size="xs" variant="ghost" color="neutral" @click="copy(json, 'The config')" />
            </div>

            <div class="row">
              <span class="type-meta">Token</span>
              <code class="token">{{ revealed ? connection.token : masked }}</code>
              <UButton
                :label="revealed ? 'Hide' : 'Show'"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="() => { revealed = !revealed }"
              />
              <UButton
                label="Copy"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="copy(connection.token, 'The token')"
              />
            </div>
            <p class="type-detail">
              It lives at <span class="font-mono">{{ connection.path }}</span>, mode 0600. Anything
              that can read that file already runs as you — the token is a wall against a web page,
              not against you.
            </p>
          </template>

          <!--
            The token is handed out on the loopback interface only, proved from
            the socket. A development server sits behind Vite's proxy, which
            loses the peer address — so this page cannot read it here, and says
            so rather than pretending the feature is broken.
          -->
          <p v-else class="type-meta">
            The token is not readable from this page: it is handed out on the loopback interface
            only, proved from the socket rather than from a header, and a development server sits
            behind a proxy that loses that. <b>Add it to this project</b> above still works — the
            file is written on the server, where the token already is. To paste it by hand, read it
            off disk.
          </p>
          <p v-if="unreadable" class="type-detail">{{ unreadable }}</p>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
}
.head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.note {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.55;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text-secondary);
}
.note--ok { border-left: 2px solid var(--success); }
.note--refused { border-left: 2px solid var(--warning); }

.manual { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
.disclose {
  align-self: flex-start;
  font-size: var(--fs-micro);
  color: var(--accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.disclose:hover { text-decoration: underline; }

.block { display: flex; align-items: flex-start; gap: 8px; }
.block pre {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-base);
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-x: auto;
}

.token {
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-micro);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
</style>
