# WedPlan Server

REST API backend for **WedPlan**, a wedding-service marketplace where vendors list their services and customers send booking requests. Built with **Node.js, Express 5, and MongoDB**, and deployed on **Vercel**.

## Features

- **Services** — vendors create, read, update, and delete wedding services.
- **Bookings** — customers request bookings, cancel their own pending requests, and vendors accept or reject them.
- **Subscription limits** — vendors on the free plan can publish up to **3 services**; active premium subscriptions remove the limit.
- **CORS allowlist** — configurable list of trusted client origins.
- **Vercel ready** — the Express app is exported as a serverless handler.

## Tech Stack

| Layer      | Technology              |
| ---------- | ----------------------- |
| Runtime    | Node.js (ES Modules)    |
| Framework  | Express 5               |
| Database   | MongoDB (official driver) |
| Config     | dotenv                  |
| Middleware | cors, express.json()    |
| Deployment | Vercel                  |
| Dev server | Nodemon                 |

## Getting Started

### Prerequisites

- Node.js 18+
- A MongoDB Atlas cluster (or local MongoDB instance)

### Installation

```bash
git clone https://github.com/NewI3e/wedplan-server.git
cd wedplan-server
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
DB_USER=your_mongodb_username
DB_PASS=your_mongodb_password
CLIENT_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://your-client.vercel.app
```

| Variable         | Required | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `DB_USER`        | Yes      | MongoDB user for the Atlas connection string.                                |
| `DB_PASS`        | Yes      | MongoDB password.                                                            |
| `CLIENT_ORIGINS` | No       | Comma-separated list of allowed origins. Defaults to localhost + the deployed client. |

The database name is `wedplandb`.

### Running Locally

```bash
npm run dev
```

The API starts at **http://localhost:5000**.

## API Reference

Base URL (local): `http://localhost:5000`

### Health Check

| Method | Endpoint | Description              |
| ------ | -------- | ------------------------ |
| GET    | `/`      | Returns `wedplan server!` |

### Users

| Method | Endpoint  | Description             |
| ------ | --------- | ----------------------- |
| GET    | `/users`  | List all user accounts. |

### Services

| Method | Endpoint                                   | Description                                                        |
| ------ | ------------------------------------------ | ------------------------------------------------------------------ |
| GET    | `/services`                                | List all services.                                                 |
| GET    | `/services/count?vendorEmail=<email>`      | Count services (all, or filtered by vendor).                       |
| GET    | `/services/usage?vendorEmail=<email>`      | Get plan, limit, used, remaining, and `canCreate` for a vendor.    |
| GET    | `/My-services?email=<email>`               | List all services owned by a vendor.                               |
| POST   | `/services`                                | Create a service (enforces the free-plan limit).                   |
| PATCH  | `/services/:id`                            | Update an existing service.                                        |
| DELETE | `/services/:id`                            | Delete a service.                                                  |

**Create service — request body**

```json
{
  "name": "Grand Ballroom",
  "category": "Venue",
  "location": "Dhaka",
  "price": 50000,
  "description": "Elegant ballroom for up to 500 guests.",
  "photoUrl": "https://example.com/photo.jpg",
  "vendorEmail": "vendor@example.com"
}
```

> `price` must be greater than `0`. New services are created with `status: "pending"` and `available: true`.

**Free-plan limit response (HTTP 403)**

```json
{
  "success": false,
  "code": "SUBSCRIPTION_REQUIRED",
  "message": "You've reached the Free plan limit of 3 services. Subscribe to add more.",
  "usage": {
    "plan": "free",
    "limit": 3,
    "used": 3,
    "remaining": 0,
    "canCreate": false
  }
}
```

**Updatable service fields:** `name`, `category`, `location`, `price`, `description`, `photoUrl`, `available`.

### Bookings

| Method | Endpoint                              | Description                                                        |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| POST   | `/bookings`                           | Create a booking request for a service.                            |
| GET    | `/bookings?email=<customerEmail>`     | List a customer's bookings (newest first).                         |
| GET    | `/bookings/vendor?email=<vendorEmail>`| List booking requests for a vendor (newest first).                 |
| PATCH  | `/bookings/:id/cancel`                | Cancel a pending booking (customer only).                          |
| PATCH  | `/bookings/:id/decision`              | Accept or reject a pending booking (vendor only).                  |

**Create booking — request body**

```json
{
  "serviceId": "64f1c2b3e4b0a1d2c3e4f5a6",
  "customerEmail": "customer@example.com",
  "eventDate": "2026-06-15",
  "eventLocation": "Gulshan, Dhaka",
  "message": "We expect around 300 guests."
}
```

A booking is stored with `status: "pending"`, plus denormalized `serviceName`, `vendorEmail`, `customerName`, `price`, and `createdAt`.

**Cancel booking — request body**

```json
{ "customerEmail": "customer@example.com" }
```

**Vendor decision — request body**

```json
{
  "vendorEmail": "vendor@example.com",
  "decision": "accepted"
}
```

`decision` must be `"accepted"` or `"rejected"`. Only `pending` bookings can be cancelled or decided, and only by their owning customer or vendor respectively.

## Database Schema

Database: **`wedplandb`**

| Collection      | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `user`          | User accounts (`email`, `name` / `displayName`, etc.).               |
| `services`      | Vendor services (`name`, `category`, `location`, `price`, `description`, `photoUrl`, `vendorEmail`, `status`, `available`, `createdAt`). |
| `bookings`      | Booking requests (`serviceId`, `serviceName`, `customerEmail`, `customerName`, `vendorEmail`, `eventDate`, `eventLocation`, `message`, `price`, `status`, `createdAt`). |
| `subscriptions` | Vendor subscriptions (`vendorEmail`, `plan`, `status`, `currentPeriodEnd`). |

### Subscription Rules

- A subscription is considered **active** when `status: "active"` and `currentPeriodEnd` is in the future (or unset).
- **Free plan:** maximum of 3 non-rejected services.
- **Premium plan:** unlimited services.
- Pending, approved, and paused services all count toward the free limit; rejected ones do not.

## Error Handling

Most endpoints return a consistent JSON shape:

```json
{
  "success": false,
  "message": "Human-readable description of the problem."
}
```

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| 400    | Missing or invalid input, or an invalid action for the state |
| 403    | Origin blocked, wrong owner, or subscription limit reached   |
| 404    | Requested service, booking, or user not found                |
| 409    | The record changed concurrently; refresh and retry           |
| 500    | Unexpected server error                                      |

## Deployment

This project is configured for **Vercel**. The Express app is exported as the default export in `index.js` and runs as a serverless function.

Before deploying, add `DB_USER`, `DB_PASS`, and `CLIENT_ORIGINS` to the Vercel project's environment variables. Note that `vercel.json` is not included; Vercel detects `index.js` automatically.

## Project Structure

```text
wedplan-server/
├── index.js          # Express app, routes, MongoDB access, plan logic
├── package.json      # Dependencies and scripts
├── package-lock.json
├── .env              # Local secrets (git-ignored)
└── .gitignore
```

## Notes

- The server listens on **port 5000**.
- The CORS layer allows requests with no `Origin` header (e.g. server-to-server and health checks).
- Emails are normalized to trimmed lowercase before every lookup and write.

## License

ISC
