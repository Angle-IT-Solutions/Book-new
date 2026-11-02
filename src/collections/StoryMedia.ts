import type { CollectionConfig } from 'payload'
import { hashMediaCapability, verifyMediaCapability } from '../lib/mediaCapabilities'

export const StoryMedia: CollectionConfig = {
  slug: 'story-media',
  admin: {
    group: 'Story Reader',
    useAsTitle: 'alt',
  },
  access: {
    create: ({ req }) => Boolean(req.user) || verifyMediaCapability(req.headers.get('x-media-capability')),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => {
      if (req.user) return true
      const capability = req.headers.get('x-media-capability')
      if (!verifyMediaCapability(capability)) return false
      return { deleteCapabilityHash: { equals: hashMediaCapability(capability) } }
    },
  },
  hooks: {
    beforeChange: [
      ({ data, operation, req }) => {
        if (operation !== 'create' || req.user) return data
        const capability = req.headers.get('x-media-capability')
        if (!verifyMediaCapability(capability)) return data
        return { ...data, deleteCapabilityHash: hashMediaCapability(capability) }
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'deleteCapabilityHash',
      type: 'text',
      admin: { hidden: true },
      access: {
        read: () => false,
        create: ({ req }) => Boolean(req.user) || verifyMediaCapability(req.headers.get('x-media-capability')),
        update: () => false,
      },
    },
  ],
  upload: {
    mimeTypes: ['image/*', 'audio/*'],
  },
}
