import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getStore } from '@netlify/blobs'
import { cloudStoragePlugin } from '@payloadcms/plugin-cloud-storage'
import type { Adapter } from '@payloadcms/plugin-cloud-storage/types'
import { buildStoragePathData, resolveSignedURLKey } from '@payloadcms/plugin-cloud-storage/utilities'
import type { Endpoint, StorageAdapter } from 'payload'
import { verifyClientUploadReceipt } from 'payload/internal'

const storeName = 'payload-media'
const maxUploadBytes = 4 * 1024 * 1024
const isNetlify = () => process.env.NETLIFY === 'true'

const getStoreForUploads = () => getStore({ name: storeName, consistency: 'strong' })

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const localFilePath = (key: string) => {
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd())
  const filePath = path.resolve(root, /*turbopackIgnore: true*/ key)
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid upload storage path.')
  }
  return filePath
}

const writeObject = async (
  key: string,
  bytes: Uint8Array,
  mimeType: string,
  onlyIfNew = false,
) => {
  if (isNetlify()) {
    const result = await getStoreForUploads().set(key, toArrayBuffer(bytes), {
      metadata: { mimeType },
      ...(onlyIfNew ? { onlyIfNew: true } : {}),
    })
    if (onlyIfNew && !result.modified) throw new Error('This upload has already been used.')
    return
  }

  const filePath = localFilePath(key)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes, onlyIfNew ? { flag: 'wx' } : undefined)
}

const deleteObject = async (key: string) => {
  if (isNetlify()) return getStoreForUploads().delete(key)
  await rm(localFilePath(key), { force: true })
}

const readObject = async (key: string) => {
  if (isNetlify()) {
    const entry = await getStoreForUploads().getWithMetadata(key, { type: 'arrayBuffer' })
    return entry as { data: ArrayBuffer; metadata: Record<string, unknown> } | null
  }

  try {
    const data = await readFile(localFilePath(key))
    return { data: toArrayBuffer(data), metadata: {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const getBlobKey = ({
  collectionPrefix,
  filename,
  prefix,
}: {
  collectionPrefix: string
  filename: string
  prefix?: string
}) =>
  buildStoragePathData({
    collectionPrefix,
    docPrefix: prefix,
    filename,
  }).storageFilePath

const makeUploadEndpoint = (collectionSlug: string): Endpoint => ({
  path: `/${collectionSlug}/blob-upload`,
  method: 'put',
  handler: async (req) => {
    if (!req.url || typeof req.arrayBuffer !== 'function') {
      return Response.json({ errors: [{ message: 'Invalid upload request.' }] }, { status: 400 })
    }
    const filename = new URL(req.url).searchParams.get('filename')
    const signedReceipt = req.headers.get('x-payload-upload-receipt')
    if (!filename || !signedReceipt) {
      return Response.json({ errors: [{ message: 'Invalid upload reference.' }] }, { status: 400 })
    }

    let receipt: ReturnType<typeof verifyClientUploadReceipt>
    try {
      receipt = verifyClientUploadReceipt({ collectionSlug, filename, req, signedReceipt })
    } catch {
      return Response.json({ errors: [{ message: 'Invalid upload reference.' }] }, { status: 403 })
    }

    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength < 1 || bytes.byteLength > maxUploadBytes) {
      return Response.json({ errors: [{ message: 'Files must be no larger than 4 MB.' }] }, { status: 413 })
    }

    try {
      await writeObject(
        receipt.storageFilePath,
        bytes,
        req.headers.get('content-type') || 'application/octet-stream',
        true,
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'This upload has already been used.') {
        return Response.json({ errors: [{ message: error.message }] }, { status: 409 })
      }
      throw error
    }

    return new Response(null, { status: 204 })
  },
})

const createAdapter: Adapter = ({ collection, prefix = '' }) => ({
  name: 'netlify-blobs',
  supportsTempFiles: true,
  copyFile: async ({ from, to }) => {
    if (isNetlify()) {
      const source = await readObject(from)
      if (!source) throw new Error('The source upload does not exist.')
      const result = await getStoreForUploads().set(to, source.data, {
        metadata: source.metadata,
        onlyIfNew: true,
      })
      if (!result.modified) throw new Error('The destination upload already exists.')
      return
    }

    const targetPath = localFilePath(to)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(localFilePath(from), targetPath)
  },
  deleteFile: async ({ storageFilePath }) => deleteObject(storageFilePath),
  handleDelete: async ({ storageFilePath }) => deleteObject(storageFilePath),
  handleUpload: async ({ data, file, storageFilePath }) => {
    if (file.uploadReference) return data
    const bytes = file.tempFilePath ? await readFile(file.tempFilePath) : file.buffer
    await writeObject(storageFilePath, bytes, file.mimeType)
    return data
  },
  moveFile: async ({ from, to }) => {
    if (isNetlify()) {
      const source = await readObject(from)
      if (!source) throw new Error('The source upload does not exist.')
      const result = await getStoreForUploads().set(to, source.data, {
        metadata: source.metadata,
        onlyIfNew: true,
      })
      if (!result.modified) throw new Error('The destination upload already exists.')
      await deleteObject(from)
      return
    }

    const targetPath = localFilePath(to)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(localFilePath(from), targetPath)
    await rm(localFilePath(from), { force: true })
  },
  uploadInstructions: {
    enabled: true,
    generate: async ({ collectionSlug, filename, filesize, mimeType, req }) => {
      if (filesize < 1 || filesize > maxUploadBytes) {
        throw new Error('Files must be no larger than 4 MB.')
      }

      const resolved = await resolveSignedURLKey({
        collectionPrefix: prefix,
        collectionSlug,
        filename,
        req,
      })
      const requestURL = req.url ? new URL(req.url) : new URL(req.payload.config.serverURL || 'http://localhost')
      const apiRoute = req.payload.config.routes.api.replace(/\/$/, '')
      const url = new URL(
        `${apiRoute}/${collectionSlug}/blob-upload`,
        requestURL.origin,
      )
      url.searchParams.set('filename', resolved.sanitizedFilename)

      return {
        type: 'http',
        file: {
          filename: resolved.sanitizedFilename,
          mimeType,
          size: filesize,
          uploadReference: resolved.uploadReference,
        },
        request: {
          headers: {
            'Content-Type': mimeType,
            'x-payload-upload-receipt': resolved.uploadReference.signedReceipt,
          },
          method: 'PUT',
          url: url.toString(),
        },
      }
    },
    requiresUploadReceipt: true,
    useInAdmin: true,
  },
  staticHandler: async (req, { doc, headers, params: { filename, prefix: docPrefix } }) => {
    const key = getBlobKey({ collectionPrefix: prefix, prefix: docPrefix, filename })
    const entry = await readObject(key)
    if (!entry) return new Response('Not found', { status: 404 })

    const data = entry.data
    const size = data.byteLength
    const docMimeType = (doc as { mimeType?: string } | undefined)?.mimeType
    const storedMimeType = entry.metadata.mimeType
    const mimeType = docMimeType || (typeof storedMimeType === 'string' ? storedMimeType : 'application/octet-stream')
    const responseHeaders = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(size),
      'Content-Type': mimeType,
    })
    const range = headers?.get('range') || req.headers.get('range')

    if (!range) return new Response(data, { headers: responseHeaders })

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || size === 0) {
      responseHeaders.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers: responseHeaders })
    }

    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      responseHeaders.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers: responseHeaders })
    }

    const body = data.slice(start, end + 1)
    responseHeaders.set('Content-Length', String(body.byteLength))
    responseHeaders.set('Content-Range', `bytes ${start}-${end}/${size}`)
    return new Response(body, { status: 206, headers: responseHeaders })
  },
})

const scopedPrefix = (collectionSlug: string) => {
  if (!isNetlify()) return collectionSlug
  const context = process.env.CONTEXT || process.env.NETLIFY_DEPLOY_CONTEXT || 'production'
  if (context === 'production') return `production/${collectionSlug}`
  const branch = (process.env.BRANCH || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${context}/${branch}/${collectionSlug}`
}

export const netlifyBlobsStorage = (): StorageAdapter => ({
  name: 'netlify-blobs',
  collections: ['media', 'story-media'],
  init: (incomingConfig) => {
    const configWithEndpoints = {
      ...incomingConfig,
      endpoints: [
        ...(incomingConfig.endpoints || []),
        makeUploadEndpoint('media'),
        makeUploadEndpoint('story-media'),
      ],
    }

    return cloudStoragePlugin({
      collections: {
        media: { adapter: createAdapter, prefix: scopedPrefix('media') },
        'story-media': { adapter: createAdapter, prefix: scopedPrefix('story-media') },
      },
    })(configWithEndpoints)
  },
})