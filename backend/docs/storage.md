# Storage

Local storage is used only for MVP/dev uploads.

Current defaults:

```env
STORAGE_DRIVER=local
LOCAL_UPLOADS_DIR=storage/uploads
```

For production, replace local disk storage with an object storage provider such as S3, Cloudflare R2, DigitalOcean Spaces, or another compatible service. The file APIs use `FileStorageAdapter`, so the provider can be changed without rewriting upload/download routes.
