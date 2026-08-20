import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { compactAge, toLines } from '../../format'
import type { InboxSource } from '../../types'
import { Confirm, EmptyState } from '../components'
import { useStudio } from '../context'
import { ACCENT } from '../theme'

/** Something waiting for you somewhere that is not this app. */
export function InboxPane({
  source,
  itemId,
  focused,
  width,
  onChanged,
}: {
  source: InboxSource | undefined
  itemId: string
  focused: boolean
  width: number
  onChanged: () => void
}) {
  const { api, keys, jobs, openBrowser } = useStudio()
  const [confirming, setConfirming] = useState(false)
  const item = source?.items.find(entry => entry.id === itemId)

  useInput((input, key) => {
    if (!source) return
    if (confirming) {
      if (input === 'y') {
        setConfirming(false)
        void look()
      }
      if (input === 'n' || key.escape) setConfirming(false)
      return
    }
    if (keys.matches('inbox.look', input, key)) setConfirming(true)
    if (keys.matches('inbox.dismiss', input, key) && item) void dismiss()
    if ((keys.matches('browser', input, key) || key.return) && item) openBrowser(item.url)
  }, { isActive: focused })

  async function look() {
    if (!source) return
    await jobs.run(
      `look:${source.key}`,
      `Looking at ${source.label} again`,
      () => api.refreshInbox(source.key),
    )
    onChanged()
  }

  async function dismiss() {
    if (!source || !item) return
    await jobs.run(`dismiss:${item.id}`, `Dismissing`, () => api.dismissInbox(source.key, item.id))
    onChanged()
  }

  if (!source) return <EmptyState>That source is gone.</EmptyState>

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color={ACCENT} bold>{item?.title ?? source.label}</Text>
      </Text>
      <Box paddingTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {toLines(item?.why ?? source.error ?? 'Nothing waiting from this source.', width).map((line, i) => (
          <Text key={i} color="gray">{line || ' '}</Text>
        ))}
        <Box paddingTop={1} flexDirection="column">
          <Text color="gray" wrap="truncate">{item?.url ?? ''}</Text>
          <Text color="gray">
            {[
              source.label,
              source.checkedAt ? `checked ${compactAge(source.checkedAt)} ago` : 'never checked',
              source.costUsd != null ? `last look $${source.costUsd.toFixed(2)}` : '',
            ].filter(Boolean).join(' · ')}
          </Text>
        </Box>
      </Box>
      {confirming ? (
        <Confirm
          question={`Look at ${source.label} again?`}
          detail={['It reads the source with an agent, which takes a minute and costs money.']}
        />
      ) : null}
      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">
          {keys.hint(['inbox.look', 'inbox.dismiss', 'browser'])}
        </Text>
      </Box>
    </Box>
  )
}
