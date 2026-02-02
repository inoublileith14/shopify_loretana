# Supabase New Project Setup Guide

This guide will help you set up a new Supabase project for the Loretana Backend.

## 📋 What You Need to Create

### 1. Storage Bucket

**Bucket Name:** `customizer-uploads`

**Configuration:**
- **Public Access:** ✅ Make it PUBLIC (uncheck "Make it private")
- **Purpose:** Stores all uploaded images, QR codes, and customizer files

**Storage Structure:**
```
customizer-uploads/
├── customizer/
│   └── {sessionId}/
│       ├── original.png
│       ├── shape.png
│       ├── qr.png
│       └── qr_code.png
└── products/
    └── {code}/
        ├── {code}.png
        └── qr_code.png
```

**How to Create:**
1. Go to your Supabase project dashboard
2. Click **Storage** in the left sidebar
3. Click **"New bucket"**
4. Name: `customizer-uploads`
5. **Uncheck** "Make it private" (important for public URLs)
6. Click **"Create bucket"**

---

### 2. Database Table

**Table Name:** `uploads`

**SQL Migration:**
Run the SQL script from `SUPABASE_UPLOADS_TABLE_MIGRATION.sql` in your Supabase SQL Editor.

**How to Create:**
1. Go to your Supabase project dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **"New query"**
4. Copy and paste the entire contents of `SUPABASE_UPLOADS_TABLE_MIGRATION.sql`
5. Click **"Run"** (or press Ctrl+Enter)

**What This Creates:**
- ✅ `uploads` table with all required columns
- ✅ Indexes for fast lookups (code, session_id, created_at)
- ✅ Row Level Security (RLS) policies
- ✅ Auto-update timestamp trigger
- ✅ Public read access (for QR code scanning)
- ✅ Authenticated insert access

---

## 🔑 Required Environment Variables

After creating your Supabase project, update your `.env` file with:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
# OR (if not using service role key)
SUPABASE_ANON_KEY=your-anon-key-here
```

**How to Get These:**
1. Go to **Settings** → **API** in your Supabase dashboard
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Service role key** → `SUPABASE_SERVICE_ROLE_KEY` (recommended for backend)
   - **Anon key** → `SUPABASE_ANON_KEY` (alternative)

**⚠️ Important:** Use `SUPABASE_SERVICE_ROLE_KEY` for backend operations as it bypasses RLS policies.

---

## 📊 Table Schema Reference

The `uploads` table structure:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `code` | VARCHAR(10) | Unique short code (e.g., "ABC123XY") |
| `session_id` | VARCHAR(255) | Original session ID from customizer |
| `image_url` | TEXT | URL of the customized/shaped image |
| `original_image_url` | TEXT | Original image before customization |
| `shaped_image_url` | TEXT | Shaped/masked version |
| `product_id` | VARCHAR(255) | Shopify product ID |
| `product_name` | VARCHAR(255) | Product name |
| `product_image_url` | TEXT | Product image URL |
| `metadata` | JSONB | Custom data (zoom, x, y, shape, etc.) |
| `created_at` | TIMESTAMP | Auto-set on creation |
| `updated_at` | TIMESTAMP | Auto-updated on changes |
| `expires_at` | TIMESTAMP | Optional expiration date |

**Indexes:**
- `uploads_code_idx` - Fast lookup by code
- `uploads_session_id_idx` - Fast lookup by session
- `uploads_created_at_idx` - Time-based queries

---

## ✅ Verification Checklist

After setup, verify:

- [ ] Storage bucket `customizer-uploads` exists and is PUBLIC
- [ ] Database table `uploads` exists with all columns
- [ ] RLS policies are enabled and configured
- [ ] Indexes are created
- [ ] Environment variables are set in `.env`
- [ ] Test upload works: `POST /customizer/upload`

---

## 🧪 Testing

After setup, test your configuration:

```bash
# Build the project
npm run build

# Start the server
npm run start:dev

# Test in Postman or curl:
# POST http://localhost:3000/customizer/upload
# (with a PNG/JPG file)
```

If successful, you should see files appear in your `customizer-uploads` bucket!

---

## 📚 Related Documentation

- `SUPABASE_UPLOADS_TABLE_MIGRATION.sql` - Complete SQL migration
- `SUPABASE_SETUP.md` - Original setup guide
- `RLS_FIX.md` - Troubleshooting RLS issues
- `PRODUCT_UPLOADS_GUIDE.md` - Product uploads feature guide

---

## 🆘 Troubleshooting

### "Bucket not found" error
- Verify bucket name is exactly `customizer-uploads`
- Check bucket is created and public

### "Table does not exist" error
- Run the SQL migration script
- Verify table name is `uploads` (lowercase)

### "RLS policy violation" error
- Use `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_ANON_KEY`
- Or check RLS policies in Supabase dashboard

### "Permission denied" error
- Ensure bucket is PUBLIC (not private)
- Check service role key is correct
