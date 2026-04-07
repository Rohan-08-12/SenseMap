# SenseMap (AutisticAI)

SenseMap is a full-stack sensory mapping application that crowdsources and calculates sensory scores (noise, lighting, crowds, and comfort) for public spaces, helping neurodivergent individuals and those with sensory sensitivities find suitable places to visit.

This `clean-dev` branch has been fully documented with architectural JSDoc comments across the core backend routes and frontend React components to clearly explain how the application works under the hood.

## 🚀 Tech Stack

- **Frontend:** React (Vite), Deck.gl (Mapping), Axios
- **Backend:** Node.js, Express
- **Database:** PostgreSQL (hosted on Supabase), Prisma ORM
- **Authentication:** Auth0
- **AI Integrations:** Google Gemini (Review parsing & sentiment analysis)
- **Media:** Cloudinary (Image uploads)

## 📁 Project Structure

The project is structured as a monorepo containing two main directories:

- `/backend`: The Express server, Prisma schema, and API routes.
- `/frontend`: The React application and UI components.

## 🛠️ Local Development Setup

To run this project locally, you will need to set up environment configurations for both the frontend and the backend.

### 1. Install Dependencies
Run npm install in both directories:
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Environment Variables

**Backend (`backend/.env`):**
Requires keys for PostgreSQL, Auth0, Google Places, Cloudinary, and Gemini. (These are intentionally not checked into version control for security purposes. Please contact the repo owner for the `.env` configuration file).

**Frontend (`frontend/.env`):**
Requires keys for Mapbox and Auth0, as well as the local API base URL:
```env
VITE_API_URL=http://127.0.0.1:3000
```

### 3. Run the Development Servers
From the root directory, you can start both the frontend and backend concurrently using the root package.json:

```bash
npm install # Installs dependencies for concurrently
npm run dev:servers
```

- **Frontend** will be running at `http://localhost:5173`
- **Backend** will be running at `http://localhost:3000`

## 🧠 AI Review Analysis
The application features an AI integration that analyzes text-based user reviews using Google Gemini. It automatically extracts estimated noise, lighting, and crowd levels from the user's natural language, which are then fed into the global scoring matrix for the location.

> **Note:** The core code architecture, API routing logic, and Map integration logic are thoroughly commented within the files themselves in this branch.
