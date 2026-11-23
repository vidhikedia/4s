# Campus Skill Exchange — Deployment Guide

This guide provides click-by-click instructions to deploy:
- **Database**: PostgreSQL on [Neon](https://neon.tech)
- **Backend API**: Node.js Web Service on [Render](https://render.com)
- **Frontend SPA**: React (Vite) on [Vercel](https://vercel.com)

---

## Architecture Overview

```
┌─────────────────────────┐          HTTPS / REST API          ┌─────────────────────────┐
│     Vercel Frontend     │ ─────────────────────────────────> │     Render Backend      │
│  (React 19 + Vite SPA)  │ <───────────────────────────────── │  (Node.js HTTP Server)  │
└─────────────────────────┘      CORS: FRONTEND_ORIGIN         └────────────┬────────────┘
                                                                            │
                                                                            │ SSL Connection
                                                                            │ (pg Pool)
                                                                            ▼
                                                               ┌─────────────────────────┐
                                                               │      Neon Database      │
                                                               │  (Serverless Postgres)  │
                                                               └─────────────────────────┘
```

---

## Step 1: Create PostgreSQL Database on Neon

1. Navigate to **[https://console.neon.tech](https://console.neon.tech)** and sign in (or create a free account).
2. Click **Create Project**.
3. Configure your project:
   - **Project name**: `skill-exchange-db` (or your choice)
   - **Postgres version**: `16` or `17` (default)
   - **Region**: Choose the region closest to where your backend will run (e.g., `AWS us-east-2 (Ohio)`).
4. Click **Create Project**.
5. Once created, you will see the **Connection Details** modal:
   - Select **Connection string** in the dropdown.
   - Choose **PostgreSQL** or **Node.js** client.
   - Make sure **Pooled connection** or standard direct string is selected (e.g. `postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require`).
   - Copy this connection string. This is your **`DATABASE_URL`**.

---

## Step 2: Deploy Backend Web Service on Render

1. Navigate to **[https://dashboard.render.com](https://dashboard.render.com)** and sign in.
2. Click **New +** in the top navigation bar and select **Web Service**.
3. Connect your GitHub repository containing the Campus Skill Exchange code.
4. Configure the service settings:
   - **Name**: `skill-exchange-api` (or any unique name)
   - **Region**: Match your Neon database region (e.g., `Ohio (US East)`) for lowest latency.
   - **Branch**: `main`
   - **Root Directory**: `skill-exchange-backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free** (or Starter)
5. Expand the **Environment Variables** section and add the following keys:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production mode |
| `PORT` | `10000` | (Render sets this automatically; server listens on `process.env.PORT`) |
| `DATABASE_URL` | `postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require` | Your Neon connection string from Step 1 |
| `JWT_SECRET` | `generate-a-strong-random-secret-key-at-least-32-chars-long` | Secret phrase used to sign authentication tokens |
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` | Your Vercel frontend URL (set temporary `http://localhost:5173` if Vercel URL is not known yet, then update) |
| `TRUST_PROXY` | `true` | Enables correct client IP extraction through Render's reverse proxy |
| `SEED_DEMO` | `true` | Automatically creates tables and seeds demo students, skills, and badges on first run |

> **Tip**: After the initial deployment succeeds and the database is seeded, change `SEED_DEMO` to `false` in Render so subsequent redeployments preserve user-created data.

6. Click **Deploy Web Service**.
7. Wait for the build and deployment logs to finish. You should see:
   ```
   Skill Exchange API running on http://localhost:10000
   ```
8. Copy your Render service URL from the top of the page (e.g. `https://skill-exchange-api.onrender.com`).

---

## Step 3: Deploy Frontend on Vercel

1. Navigate to **[https://vercel.com](https://vercel.com)** and sign in.
2. Click **Add New...** > **Project**.
3. Import your GitHub repository.
4. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (leave default, or set to the directory containing root `package.json`)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add:

| Key | Value | Notes |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `https://skill-exchange-api.onrender.com/api` | **Must include `/api`** and **must not end with a slash `/`** |

6. Click **Deploy**.
7. Once deployed, copy your production Vercel URL (e.g. `https://skill-exchange.vercel.app`).
8. Return to your **Render Web Service settings**, open **Environment Variables**, and update `FRONTEND_ORIGIN` to match your exact Vercel URL:
   ```
   FRONTEND_ORIGIN=https://skill-exchange.vercel.app
   ```
   Save changes (Render will automatically redeploy with the updated CORS origin).

---

## Step 4: Verification Checklist (How to Test After Deploy)

### 1. Backend Health Check
Open your browser or terminal and test the health endpoint:
```bash
curl -i https://your-backend.onrender.com/api/health
```
**Expected Response:**
```json
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://your-frontend.vercel.app

{"status":"ok","timestamp":"2026-11-22T..."}
```

### 2. Verify CORS Preflight
Verify OPTIONS preflight allows Authorization headers:
```bash
curl -X OPTIONS https://your-backend.onrender.com/api/students \
  -H "Origin: https://your-frontend.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" -i
```
**Expected Status:** `204 No Content` with `Access-Control-Allow-Origin: https://your-frontend.vercel.app`.

### 3. Public Leaderboard Test
```bash
curl -i https://your-backend.onrender.com/api/leaderboard
```
**Expected Response:** `200 OK` returning an array of students with rank, power level, and badges, excluding passwords, emails, and phone numbers.

### 4. End-to-End User Flow
1. Open your Vercel frontend URL: `https://your-frontend.vercel.app`.
2. **Login with Demo Account**:
   - **Email**: `kediavidhi62@gmail.com`
   - **Password**: `password123`
3. Verify that the **Dashboard**, **My Skills**, **Matches**, and **Sessions** load live data from Neon.
4. **Register a New Student**:
   - Log out, go to `/register`, and create a new account.
   - Verify that registration generates a JWT token and loads the profile.
5. **Data Persistence**:
   - Offer a new skill from the dashboard.
   - Refresh the page and confirm the skill persists in the Neon database.

---

## Step 5: Testing PostgreSQL Locally or in a Staging Database

To test the Postgres path against a real Neon or local Postgres database before full deployment:

1. Create a test database on Neon or locally (`createdb test_skillexchange`).
2. Run the tests pointing to Postgres:
   ```bash
   cd skill-exchange-backend
   DATABASE_URL="postgresql://user:pass@ep-sample.us-east-2.aws.neon.tech/test_db?sslmode=require" npm test
   ```
3. The test suite automatically detects `DATABASE_URL`, connects via `pg`, runs schema migrations, seeds test data, and asserts all 292 test cases against Postgres.
