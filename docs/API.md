# Job Search Platform - API Documentation

## Base URL

```
http://localhost:3000/api
```

## Authentication

The API uses JWT (JSON Web Token) for authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### Authentication

#### Register User

**POST** `/auth/register`

Creates a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (201):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "email": "user@example.com",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**
- `400` - Invalid email or password format
- `409` - Email already registered

---

#### Login

**POST** `/auth/login`

Authenticates user and returns JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "email": "user@example.com",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**
- `401` - Invalid email or password
- `404` - User not found

---

#### Set Claude API Token

**POST** `/auth/set-claude-token`

Store user's Claude API token for AI-powered search.

**Required Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request:**
```json
{
  "claudeApiToken": "sk-ant-v1-abc123xyz..."
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Claude token updated"
}
```

**Error Responses:**
- `401` - Unauthorized (missing or invalid token)
- `400` - Missing claudeApiToken

---

### Search

All search endpoints require authentication.

#### Create Search

**POST** `/searches`

Initiates a new job search session.

**Required Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request:**
```json
{
  "query": "Python developer in San Francisco"
}
```

**Response (201):**
```json
{
  "searchId": "507f1f77bcf86cd799439012",
  "status": "running"
}
```

**Error Responses:**
- `400` - Query required
- `401` - Unauthorized

---

#### Get Search Status

**GET** `/searches/{searchId}`

Retrieves the current status of a search session.

**Required Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "searchId": "507f1f77bcf86cd799439012",
  "status": "running",
  "query": "Python developer in San Francisco",
  "iterationCount": 2,
  "foundJobsCount": 15
}
```

**Status Values:**
- `running` - Search is in progress
- `complete` - Search finished successfully
- `failed` - Search encountered an error

**Error Responses:**
- `404` - Search not found
- `403` - Access denied (search belongs to different user)
- `401` - Unauthorized

---

#### Get Jobs from Search

**GET** `/searches/{searchId}/jobs`

Retrieves ranked job listings from a completed search.

**Required Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "jobs": [
    {
      "id": "507f1f77bcf86cd799439013",
      "title": "Senior Python Developer",
      "company": "Tech Corp",
      "description": "We're looking for an experienced Python developer...",
      "url": "https://techcorp.com/jobs/python-dev",
      "salary": "$120,000 - $160,000",
      "location": "San Francisco, CA",
      "matchScore": 95,
      "matchReasoning": "Strong match: 10+ years Python experience, remote-friendly..."
    },
    {
      "id": "507f1f77bcf86cd799439014",
      "title": "Python Backend Engineer",
      "company": "StartupXYZ",
      "description": "Looking for a backend engineer experienced in Python...",
      "url": "https://startupxyz.com/careers/backend",
      "salary": "$100,000 - $140,000",
      "location": "Remote",
      "matchScore": 87,
      "matchReasoning": "Good match: Python expertise, benefits package includes..."
    }
  ]
}
```

Jobs are automatically sorted by `matchScore` in descending order.

**Error Responses:**
- `404` - Search not found
- `403` - Access denied
- `401` - Unauthorized

---

### Crawler

#### Scrape Job Listings

**POST** `/crawler/scrape`

Directly trigger web crawling for specific URLs and keywords. This endpoint is used internally but can be called directly for advanced use cases.

**Request:**
```json
{
  "urls": [
    "https://example-jobs.com/listings",
    "https://another-job-board.com/careers"
  ],
  "keywords": [
    "Python",
    "Backend",
    "San Francisco"
  ]
}
```

**Response (200):**
```json
{
  "foundCount": 5,
  "jobs": [
    {
      "title": "Senior Python Developer",
      "company": "TechCorp",
      "description": "Job description here...",
      "url": "https://example-jobs.com/listings/123",
      "salary": "$120,000 - $160,000",
      "location": "San Francisco, CA"
    }
  ],
  "newSites": [
    "https://discovered-job-board.com"
  ]
}
```

**Error Responses:**
- `400` - No URLs provided
- `500` - Crawler error

---

### Health Check

#### System Health

**GET** `/health`

Simple health check endpoint for monitoring.

**Response (200):**
```json
{
  "status": "ok"
}
```

---

## Error Handling

All endpoints return errors in the following format:

```json
{
  "error": "Descriptive error message"
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (access denied)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

---

## Rate Limiting

No rate limiting is currently implemented. Production deployments should add rate limiting middleware.

---

## WebSockets (Future)

Currently, search status is retrieved via polling. Future versions will support WebSocket connections for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.send(JSON.stringify({
  type: 'subscribe_search',
  searchId: 'searchId123'
}));
```

---

## Example Usage with cURL

### Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Create Search
```bash
curl -X POST http://localhost:3000/api/searches \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Python developer remote"
  }'
```

### Get Search Status
```bash
curl -X GET http://localhost:3000/api/searches/SEARCH_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Jobs
```bash
curl -X GET http://localhost:3000/api/searches/SEARCH_ID/jobs \
  -H "Authorization: Bearer YOUR_TOKEN"
```
