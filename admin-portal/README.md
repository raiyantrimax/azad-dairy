# Azad Dairy Admin Portal and API

This folder is a standalone Node service. It serves the admin dashboard at `/admin/` and the mobile app API at `/api/`. MongoDB stores accounts, addresses, products, product images (GridFS), coupons, orders and subscriptions.

## Local setup

1. Install Node.js 22.13 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Use a MongoDB Atlas database user with a strong password. The connection URI must contain a real username; do not commit secrets.
4. Run `npm run seed` to add sample dairy products and the `FRESH10` coupon.
5. Run `npm start`, then open `http://localhost:10000/admin/`.

The seed command is safe to repeat: it inserts sample records only when they do not already exist. The first server start creates the administrator configured through environment variables.

## Render deployment

The repository-root `render.yaml` deploys this folder as a Node web service. Set `MONGODB_URI`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` as private Render environment variables. Render generates `JWT_SECRET`. Add the deployed service URL to `CORS_ORIGINS` if using Expo Web. Keep the database user and password private, and configure MongoDB Atlas Network Access for the service's outbound traffic. A broad `0.0.0.0/0` rule should only be used with a dedicated, least-privilege database user and a strong password.

After the first deployment, run `npm run seed` from the service shell to create the sample catalog and coupon. The Render service health check is `/api/health`.

## Connect the Expo app

Set `EXPO_PUBLIC_API_URL` to the deployed service origin (for example, `https://your-service.onrender.com`) in the Expo build environment. For local development, use the computer's LAN IP for a physical phone; `localhost` on a phone points to the phone itself. Restart Expo after changing the variable. The app keeps its demo catalog when the API URL is unset.

## Data and API behavior

- Customer registration and login use hashed passwords and expiring bearer tokens.
- Customer addresses, orders and subscriptions are scoped to the signed-in account.
- Product discounts and coupons are recalculated by the server when an order is placed; client prices are not trusted.
- A subscription can have an optional end date. The API marks it expired after that date, and the app can show the ended status to the customer.
- Product images are limited to 8 files, 5 MB each, and stored in MongoDB GridFS.
- Orders are stored as `placed` because payment processing is not connected. Revenue in the dashboard is the sum of non-cancelled placed orders, not captured payment revenue.

## Main endpoints

Public catalog: `GET /api/products`, `GET /api/products/:id`.

Customer: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `PATCH /api/me`, `/api/me/addresses`, `/api/me/orders`, `/api/me/subscriptions`, and `POST /api/orders`.

Admin bearer token: `POST /api/admin/login`, then `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/products`, `/api/admin/images`, `/api/admin/orders`, `/api/admin/subscriptions`, and `/api/admin/coupons`.
