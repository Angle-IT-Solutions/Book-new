'use server'

import { getPayloadClient } from '@/lib/payload'
import { createMediaCapability } from '@/lib/mediaCapabilities'

export async function issueMediaCapability() {
  return createMediaCapability()
}

export async function createStory(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid story details.' }
  }

  const fields = input as Record<string, unknown>
  if (typeof fields.title !== 'string') {
    return { error: 'Enter a title between 1 and 160 characters.' }
  }

  const title = fields.title.trim()
  if (!title || title.length > 160) {
    return { error: 'Enter a title between 1 and 160 characters.' }
  }
  if (
    (fields.image !== undefined &&
      (!Number.isSafeInteger(fields.image) || (fields.image as number) < 1)) ||
    (fields.audio !== undefined &&
      (!Number.isSafeInteger(fields.audio) || (fields.audio as number) < 1))
  ) {
    return { error: 'The uploaded media reference is invalid.' }
  }

  const payload = await getPayloadClient()
  const story = await payload.create({
    collection: 'stories',
    data: {
      title,
      slug: crypto.randomUUID(),
      ...(fields.image !== undefined ? { image: fields.image as number } : {}),
      ...(fields.audio !== undefined ? { audio: fields.audio as number } : {}),
    },
    overrideAccess: false,
  })

  return { url: `/story/${story.slug}` }
}
