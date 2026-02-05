# Super Bowl With Seth 🏈

A friends & family Super Bowl props pool website with a vintage newspaper aesthetic.

## Features

- **Prop Sheet**: Create questions with multiple-choice answers, each with different point values
- **User Submissions**: Participants submit picks before the game starts
- **Hidden Picks**: Everyone's picks stay hidden until the admin starts the game
- **Live Scoring**: Mark correct answers during the game, scores update automatically
- **Leaderboard**: Real-time standings showing who's winning

## Setup for Render Deployment

### 1. Push to GitHub

```bash
cd superbowl-with-seth
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/superbowl-with-seth.git
git push -u origin main
```

### 2. Deploy to Render

1. Go to [render.com](https://render.com) and sign in
2. Click **New** → **Blueprint**
3. Connect your GitHub repository
4. Render will detect the `render.yaml` and create:
   - A PostgreSQL database
   - A web service running your Flask app

### 3. Configure Environment Variables

In the Render dashboard, go to your web service → **Environment**:

- `ADMIN_PASSWORD`: Set your admin password (e.g., `supersecret2026`)

### 4. Connect Your Domain

1. In Render dashboard → your web service → **Settings** → **Custom Domains**
2. Add `superbowlwithseth.com`
3. In Porkbun, add DNS records:
   - Type: `CNAME`
   - Host: `@` (or `www`)
   - Value: Your Render URL (e.g., `superbowl-with-seth.onrender.com`)

## Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

Visit `http://localhost:5000`

Default admin password for local dev: `seth2026`

## Admin Guide

### Before the Game

1. Go to `/admin/login` and enter your password
2. **Create Props**: Add all your prop questions with answers and point values
3. Share the link with friends/family to submit picks
4. **Lock Submissions** when you're ready (or it auto-locks when you start the game)

### During the Game

1. Click **Start Game** to reveal everyone's picks
2. Go to **Mark Answers** to select correct answers as props resolve
3. Scores update automatically on the standings page

### Point Values

Higher points = riskier picks. For example:
- "Will there be a safety?" → Yes (10 pts), No (1 pt)
- Unlikely outcomes pay more if they hit!

## Tech Stack

- **Backend**: Flask (Python)
- **Database**: PostgreSQL (Render) / SQLite (local)
- **Hosting**: Render
- **Styling**: Custom CSS (newspaper theme)

---

Made with ❤️ for Super Bowl LX

