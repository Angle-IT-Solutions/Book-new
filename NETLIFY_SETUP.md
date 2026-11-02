# Netlify Setup

## Configure the site

1. Import the GitHub repository `Angle-IT-Solutions/Book-new` into Netlify.
2. In Netlify's **Data & Storage**, enable **Database** and **Blobs** for the site.
3. Add `PAYLOAD_SECRET` under **Site configuration > Environment variables**. Generate a value with `openssl rand -hex 32` and make it available to both Builds and Functions.
4. Keep the build command from `netlify.toml`. It runs Payload migrations before building the Next.js app.
5. Deploy a preview, then test the admin page, story creation, and media uploads.

Netlify provides `NETLIFY_DB_URL` and the Blobs runtime credentials when those services are enabled. Do not copy database credentials into source files. The app uses SQLite and local files only when running outside Netlify.

## Upload limits and existing data

Uploads are limited to 4 MB each to stay below Netlify's synchronous Function request limit. Larger files need a separate direct-to-object-storage service.

The production database and Blobs store start empty. The ignored local `payload.db` and upload directories are not deployed or migrated automatically.