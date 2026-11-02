import type { CollectionConfig } from 'payload'

export const Stories: CollectionConfig = {
  slug: 'stories',
  admin: {
    group: 'Story Reader',
    useAsTitle: 'title',
  },
  access: {
    create: () => true,
    read: () => true,
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 160,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'image',
      type: 'relationship',
      relationTo: 'story-media',
    },
    {
      name: 'audio',
      type: 'relationship',
      relationTo: 'story-media',
    },
  ],
}
