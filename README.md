# The Darnold Trust Meter 🏈

A live, crowd-sourced confidence gauge for Seattle Seahawks quarterback Sam Darnold. Inspired by the famous NYT election needle.

## Features

- **Live Trust Meter**: A beautiful half-moon gauge with a jittering needle
- **Crowd-sourced**: The needle position reflects the last 100 votes
- **5-Minute Cooldown**: Prevents spam voting
- **Trust History**: A chart showing how confidence has changed over time

## Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) version 18 or higher

### Steps

1. Open Terminal (on Mac: press `Cmd + Space`, type "Terminal", press Enter)

2. Navigate to the project folder:
   ```bash
   cd /Users/seth.walder/Documents/darnold-trust-meter
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and go to: `http://localhost:3000`

---

## Deploying to the Internet (Making it Public)

I recommend **Render.com** - it's free and beginner-friendly.

### Step-by-Step Deployment Guide

#### Step 1: Create a GitHub Account (if you don't have one)
1. Go to [github.com](https://github.com)
2. Click "Sign up" and follow the prompts
3. Verify your email

#### Step 2: Install GitHub Desktop (easiest way)
1. Go to [desktop.github.com](https://desktop.github.com)
2. Download and install it
3. Sign in with your GitHub account

#### Step 3: Upload Your Code to GitHub
1. Open GitHub Desktop
2. Click "Add" → "Add Existing Repository"
3. Navigate to `/Users/seth.walder/Documents/darnold-trust-meter`
4. If it says "This directory is not a Git repository", click "Create a Repository"
5. Fill in:
   - Name: `darnold-trust-meter`
   - Description: `How Much Do You Trust Sam Darnold Right Now?`
6. Click "Create Repository"
7. Click "Publish Repository" (top right)
8. Uncheck "Keep this code private" if you want it public
9. Click "Publish Repository"

#### Step 4: Deploy on Render.com
1. Go to [render.com](https://render.com)
2. Click "Get Started for Free"
3. Sign up with your GitHub account
4. Click "New +" → "Web Service"
5. Connect your GitHub repository (`darnold-trust-meter`)
6. Configure the service:
   - **Name**: `darnold-trust-meter`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
7. Click "Create Web Service"
8. Wait a few minutes for it to deploy

#### Step 5: Get Your URL
Once deployed, Render will give you a URL like:
`https://darnold-trust-meter.onrender.com`

Share this URL and anyone can use your trust meter!

### Important Notes for Production

**Database Persistence**: The free tier of Render resets the filesystem periodically. For persistent data, you'd want to:

1. Use Render's PostgreSQL database (free tier available)
2. Or use a service like [Supabase](https://supabase.com) (free tier)

I've kept it simple with SQLite for now, but if you want the votes to persist long-term, let me know and I can help you set up a proper database.

---

## Customization Ideas

- Change "Sam Darnold" to any player/topic
- Modify the color scheme in `public/styles.css`
- Change the meter labels (YIKES/MEH/ELITE) in `public/index.html`
- Adjust the cooldown period in `server.js` (search for `fiveMinutes`)

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js with Express
- **Database**: SQLite (via better-sqlite3)
- **Charts**: Chart.js

## File Structure

```
darnold-trust-meter/
├── server.js          # Backend server & API
├── package.json       # Dependencies
├── public/
│   ├── index.html     # Main page with meter
│   ├── styles.css     # All styling
│   ├── app.js         # Frontend JavaScript
│   └── history.html   # Trust history chart page
└── README.md          # This file
```

## Need Help?

If you run into any issues, common problems include:
- **"npm not found"**: Make sure Node.js is installed
- **Port already in use**: Change the PORT in server.js or stop other servers
- **Database errors**: Delete `trustmeter.db` and restart the server

Enjoy your trust meter! 🏈

