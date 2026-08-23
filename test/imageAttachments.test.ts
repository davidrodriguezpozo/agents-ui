import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  acceptImages,
  imageMediaType,
  readImageAttachment,
  sanitiseAttachments,
  withoutImageBytes,
  type PickedImage,
} from '../app/utils/imageAttachments'
import { base64Bytes, toBase64 } from '../app/utils/base64'
import type { ChatMessage } from '../app/types'

/** A file as the browser hands it over, without needing a browser. */
function file(name: string, type: string, bytes = 10): PickedImage {
  return {
    name,
    type,
    size: bytes,
    arrayBuffer: async () => new Uint8Array(bytes).fill(65).buffer,
  }
}

describe('imageMediaType', () => {
  it('takes the browser at its word', () => {
    expect(imageMediaType({ name: 'shot.png', type: 'image/png' })).toBe('image/png')
    expect(imageMediaType({ name: 'anim.gif', type: 'image/gif' })).toBe('image/gif')
  })

  it('reads image/jpg as JPEG, which is what the clipboard meant', () => {
    expect(imageMediaType({ name: 'photo.jpg', type: 'image/jpg' })).toBe('image/jpeg')
  })

  it('falls back to the extension when the type is blank', () => {
    expect(imageMediaType({ name: 'Screenshot.WEBP', type: '' })).toBe('image/webp')
    expect(imageMediaType({ name: 'photo.JPEG', type: '' })).toBe('image/jpeg')
  })

  it('refuses what the model cannot look at', () => {
    expect(imageMediaType({ name: 'notes.pdf', type: 'application/pdf' })).toBeNull()
    expect(imageMediaType({ name: 'diagram.svg', type: 'image/svg+xml' })).toBeNull()
    expect(imageMediaType({ name: 'untitled', type: '' })).toBeNull()
  })
})

describe('acceptImages', () => {
  it('says why each refusal happened', () => {
    const { accepted, rejected } = acceptImages([
      file('shot.png', 'image/png'),
      file('notes.pdf', 'application/pdf'),
      file('huge.png', 'image/png', MAX_IMAGE_BYTES + 1),
    ])

    expect(accepted.map(f => f.name)).toEqual(['shot.png'])
    expect(rejected).toEqual([
      { name: 'notes.pdf', reason: 'not a PNG, JPEG, GIF or WebP image' },
      { name: 'huge.png', reason: 'over 5MB' },
    ])
  })

  it('counts what is already on the message against the limit', () => {
    const dropped = Array.from({ length: 3 }, (_, i) => file(`shot-${i}.png`, 'image/png'))
    const { accepted, rejected } = acceptImages(dropped, MAX_IMAGES_PER_MESSAGE - 1)

    // The bug this exists for: a composer that already held four images quietly
    // building a fifth, sixth and seventh the API would refuse.
    expect(accepted).toHaveLength(1)
    expect(rejected.map(r => r.reason)).toEqual([
      'over 5 images in one message',
      'over 5 images in one message',
    ])
  })

  it('takes nothing and complains about nothing when nothing came', () => {
    expect(acceptImages([])).toEqual({ accepted: [], rejected: [] })
  })
})

describe('readImageAttachment', () => {
  it('carries the bytes, the type and a name', async () => {
    const attachment = await readImageAttachment(file('shot.png', 'image/png', 4))

    expect(attachment.mediaType).toBe('image/png')
    expect(attachment.name).toBe('shot.png')
    expect(attachment.size).toBe(4)
    expect(attachment.data).toBe(toBase64(new Uint8Array(4).fill(65)))
  })

  it('names an unnamed paste', async () => {
    const attachment = await readImageAttachment(file('', 'image/png'))
    expect(attachment.name).toBe('pasted image')
  })
})

describe('sanitiseAttachments', () => {
  const png = toBase64(new Uint8Array(8).fill(1))

  it('keeps a well-formed image', () => {
    expect(sanitiseAttachments([{ name: 'shot.png', mediaType: 'image/png', data: png }]))
      .toEqual([{ name: 'shot.png', mediaType: 'image/png', data: png }])
  })

  it('is nothing when the field is missing or not a list', () => {
    expect(sanitiseAttachments(undefined)).toEqual([])
    expect(sanitiseAttachments('shot.png')).toEqual([])
    expect(sanitiseAttachments([null, 3, 'x'])).toEqual([])
  })

  it('drops what is not an image, not base64, or too large', () => {
    expect(sanitiseAttachments([
      { name: 'notes.pdf', mediaType: 'application/pdf', data: png },
      { name: 'shot.png', mediaType: 'image/png', data: 'not base64!' },
      { name: 'shot.png', mediaType: 'image/png' },
      { name: 'huge.png', mediaType: 'image/png', data: 'A'.repeat(MAX_IMAGE_BYTES * 2) },
    ])).toEqual([])
  })

  it('stops at the per-message limit', () => {
    const many = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 4 }, () => ({
      name: 'shot.png',
      mediaType: 'image/png',
      data: png,
    }))
    expect(sanitiseAttachments(many)).toHaveLength(MAX_IMAGES_PER_MESSAGE)
  })

  it('takes a data URL apart rather than refusing it', () => {
    expect(sanitiseAttachments([{ name: 'shot.png', mediaType: 'image/png', data: `data:image/png;base64,${png}` }]))
      .toEqual([{ name: 'shot.png', mediaType: 'image/png', data: png }])
  })

  it('recognises an image by its name when the type is nonsense', () => {
    expect(sanitiseAttachments([{ name: 'shot.png', mediaType: 'nonsense', data: png }]))
      .toEqual([{ name: 'shot.png', mediaType: 'image/png', data: png }])
  })
})

describe('withoutImageBytes', () => {
  const message: ChatMessage = {
    id: '1',
    role: 'user',
    content: 'what is wrong here',
    timestamp: 0,
    attachments: [{ id: 'a', name: 'shot.png', mediaType: 'image/png', size: 12, data: 'AAAA' }],
  }

  it('keeps the record and loses the megabytes', () => {
    expect(withoutImageBytes(message).attachments).toEqual([
      { id: 'a', name: 'shot.png', mediaType: 'image/png', size: 12 },
    ])
  })

  it('leaves a message with no attachments exactly as it was', () => {
    const plain: ChatMessage = { id: '2', role: 'assistant', content: 'ok', timestamp: 0 }
    expect(withoutImageBytes(plain)).toBe(plain)
  })
})

describe('base64Bytes', () => {
  it('agrees with the bytes that went in', () => {
    for (const size of [0, 1, 2, 3, 8, 1000]) {
      expect(base64Bytes(toBase64(new Uint8Array(size).fill(7)))).toBe(size)
    }
  })
})
