import type { ChatAttachment } from '~/types'
import { acceptImages, readImageAttachment, type PickedImage } from '~/utils/imageAttachments'
import { errorMessage } from '~/utils/errors'

/**
 * The images sitting in a composer, waiting to go with the next message.
 *
 * A `ref` rather than `useState`: two composers are open at the same time — the
 * assistant panel and the studio's test box — and each holds its own pile. This
 * is the shared *behaviour*, not shared state, so the two cannot disagree about
 * what a paste does or what happens to a file that is too large while still
 * holding different files.
 *
 * The drop zone lives here too, because a file dropped anywhere else on the page
 * is the browser navigating away from the app and taking the conversation with
 * it — so every surface with a composer wants the whole surface to catch it, and
 * wants it to behave the same way.
 */
export function useChatAttachments() {
  const toast = useToast()
  const attachments = ref<ChatAttachment[]>([])
  const dropZone = ref<HTMLElement | null>(null)
  const dragOver = ref(false)

  /**
   * Files from a paste, a drop or the file picker.
   *
   * What is refused is said out loud, naming the files: an image that quietly
   * failed to attach is one the user believes Claude is looking at.
   */
  async function attach(files: PickedImage[]) {
    const { accepted, rejected } = acceptImages(files, attachments.value.length)

    if (rejected.length) {
      toast.add({
        title: rejected.length === 1
          ? 'One image was not attached'
          : `${rejected.length} images were not attached`,
        description: rejected.map(r => `${r.name} — ${r.reason}`).join(', '),
        color: 'warning',
      })
    }

    for (const file of accepted) {
      try {
        attachments.value = [...attachments.value, await readImageAttachment(file)]
      } catch (e) {
        toast.add({ title: `Could not read ${file.name}`, description: errorMessage(e), color: 'error' })
      }
    }
  }

  function remove(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id)
  }

  function clear() {
    attachments.value = []
  }

  /** The list, and the composer empty again — what sending does. */
  function take(): ChatAttachment[] {
    const taken = attachments.value
    attachments.value = []
    return taken
  }

  /**
   * Files only, and `preventDefault` only for them.
   *
   * Both halves matter. Without the call the browser refuses the drop and then
   * opens the image in place of the app; with it on *every* drag, dropping
   * selected text into the composer stopped inserting anything, because the
   * cancelled default was the textarea's. And a drag that is not carrying files
   * should not put "drop an image here" on the screen at all.
   */
  function onDragOver(e: DragEvent) {
    if (!carriesFiles(e)) return
    e.preventDefault()
    dragOver.value = true
  }

  /**
   * `dragleave` fires every time the pointer crosses into a child element, so
   * the highlight flickered off over the message list. It is a leave only when
   * what is being entered is outside the zone.
   */
  function onDragLeave(e: DragEvent) {
    const entering = e.relatedTarget as Node | null
    if (!entering || !dropZone.value?.contains(entering)) dragOver.value = false
  }

  function onDrop(e: DragEvent) {
    if (!carriesFiles(e)) return
    e.preventDefault()
    dragOver.value = false

    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) attach(files)
  }

  return { attachments, dropZone, dragOver, attach, remove, clear, take, onDragOver, onDragLeave, onDrop }
}

function carriesFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}
