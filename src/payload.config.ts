import path from 'path'
import { buildConfig, type Endpoint } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { getConnectionString } from '@netlify/database'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { getUploadInstructions } from 'payload/internal'
import { en as adminLanguage } from '@payloadcms/translations/languages/en'
import { fileURLToPath } from 'url'
import { verifyMediaCapability } from './lib/mediaCapabilities'
import { netlifyBlobsStorage } from './lib/netlifyBlobsStorage'
import { migrations } from './migrations'
import { Admins } from './collections/Admins'
import { Media } from './collections/Media'
import { Folders } from './collections/Folders'
import { Tags } from './collections/Tags'
import { StoryMedia } from './collections/StoryMedia'
import { Stories } from './collections/Stories'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const payloadSecret = process.env.PAYLOAD_SECRET
if (!payloadSecret) {
  throw new Error('PAYLOAD_SECRET must be configured.')
}

const isNetlify = process.env.NETLIFY === 'true'
const databaseUrl = isNetlify
  ? process.env.NETLIFY_DB_URL
    ? getConnectionString()
    : undefined
  : process.env.DATABASE_URL

if (process.env.NODE_ENV === 'production' && !databaseUrl) {
  throw new Error('Enable Netlify Database or configure DATABASE_URL before building for production.')
}

const mediaUploadInstructionsEndpoint: Endpoint = {
  path: '/story-media/upload-instructions',
  method: 'post',
  handler: async (req) => {
    if (!verifyMediaCapability(req.headers.get('x-media-capability'))) {
      return Response.json({ errors: [{ message: 'A valid upload capability is required.' }] }, { status: 403 })
    }

    let input: unknown
    if (typeof req.json !== 'function') {
      return Response.json({ errors: [{ message: 'Invalid upload request.' }] }, { status: 400 })
    }
    try {
      input = await req.json()
    } catch {
      return Response.json({ errors: [{ message: 'Invalid upload request.' }] }, { status: 400 })
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return Response.json({ errors: [{ message: 'Invalid upload request.' }] }, { status: 400 })
    }

    const fields = input as Record<string, unknown>
    if (
      typeof fields.filename !== 'string' ||
      typeof fields.mimeType !== 'string' ||
      typeof fields.filesize !== 'number' ||
      !Number.isSafeInteger(fields.filesize) ||
      fields.filesize < 1 ||
      fields.filesize > 4 * 1024 * 1024
    ) {
      return Response.json({ errors: [{ message: 'Files must be no larger than 4 MB.' }] }, { status: 400 })
    }

    const instructions = await getUploadInstructions({
      collectionSlug: 'story-media',
      filename: fields.filename,
      filesize: fields.filesize,
      mimeType: fields.mimeType,
      overrideAccess: true,
      req,
    })
    return Response.json(instructions)
  },
}

const db = databaseUrl
  ? postgresAdapter({
      pool: {
        connectionString: databaseUrl,
      },
      prodMigrations: migrations,
    })
  : sqliteAdapter({
      client: {
        url: process.env.SQLITE_URL || 'file:./payload.db',
      },
    })

export default buildConfig({
  secret: payloadSecret,
  admin: {
    user: Admins.slug,
    constrainWidth: true,
    dashboard: {
      widgets: [],
      defaultLayout: [
        { widgetSlug: 'activity', width: 'full' },
        { widgetSlug: 'collections', width: 'full' },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  i18n: {
    fallbackLanguage: 'en',
    supportedLanguages: { en: adminLanguage },
  },
  upload: {
    requestSizeLimit: 5 * 1024 * 1024,
  },
  db,
  collections: [Admins, Media, StoryMedia, Stories, Folders, Tags],
  endpoints: [mediaUploadInstructionsEndpoint],
  storage: [netlifyBlobsStorage()],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  localization: {
    locales: [{ code: 'en', label: 'English' }],
    fallback: true,
    defaultLocale: 'en',
  },
  plugins: [mcpPlugin({})],
})
