import path from 'path'
import { buildConfig, type Endpoint } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { s3Storage } from '@payloadcms/storage-s3'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { getUploadInstructions } from 'payload/internal'
import { en as adminLanguage } from '@payloadcms/translations/languages/en'
import { fileURLToPath } from 'url'
import { verifyMediaCapability } from './lib/mediaCapabilities'
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

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL)
const s3Bucket = process.env.S3_BUCKET
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY
const hasS3Config = Boolean(
  s3Bucket && s3AccessKeyId && s3SecretAccessKey,
)

if (process.env.NODE_ENV === 'production' && !hasDatabaseUrl) {
  throw new Error('DATABASE_URL must point to a persistent PostgreSQL database in production.')
}
if (process.env.NODE_ENV === 'production' && !hasS3Config) {
  throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required in production.')
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
      fields.filesize > 25 * 1024 * 1024
    ) {
      return Response.json({ errors: [{ message: 'Files must be no larger than 25 MB.' }] }, { status: 400 })
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

const db = hasDatabaseUrl
  ? postgresAdapter({
      pool: {
        connectionString: process.env.DATABASE_URL,
      },
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
    requestSizeLimit: 25 * 1024 * 1024,
  },
  db,
  collections: [Admins, Media, StoryMedia, Stories, Folders, Tags],
  endpoints: [mediaUploadInstructionsEndpoint],
  storage: hasS3Config
    ? [
        s3Storage({
          clientUploads: { access: () => true },
          collections: {
            media: true,
            'story-media': true,
          },
          bucket: s3Bucket!,
          config: {
            credentials: {
              accessKeyId: s3AccessKeyId!,
              secretAccessKey: s3SecretAccessKey!,
            },
            region: process.env.S3_REGION || 'us-east-1',
            endpoint: process.env.S3_ENDPOINT,
            forcePathStyle: Boolean(process.env.S3_ENDPOINT),
          },
        }),
      ]
    : [],
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
