const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clicks (
        id SERIAL PRIMARY KEY,
        direction VARCHAR(10) NOT NULL,
        user_hash VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS snapshots (
        id SERIAL PRIMARY KEY,
        trust_level DECIMAL(5,2) NOT NULL,
        total_clicks INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON clicks(created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
  }
}

initializeDatabase();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get user hash from IP (for cooldown tracking)
function getUserHash(req) {
  let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  // x-forwarded-for can have multiple IPs, take the first one (client IP)
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  return crypto.createHash('sha256').update(ip + 'darnold-salt').digest('hex').substring(0, 16);
}

// Calculate trust level based on clicks
// If fewer than 100 votes: start at 50, move 1% per vote
// If 100+ votes: use the last 100 votes as percentages
function calculateTrustLevel(clicks) {
  const totalClicks = clicks.length;
  
  if (totalClicks === 0) {
    return 50;
  }
  
  if (totalClicks < 100) {
    const moreClicks = clicks.filter(c => c.direction === 'more').length;
    const lessClicks = totalClicks - moreClicks;
    const trustLevel = 50 + moreClicks - lessClicks;
    return Math.max(0, Math.min(100, trustLevel));
  } else {
    const recentClicks = clicks.slice(-100);
    const moreClicks = recentClicks.filter(c => c.direction === 'more').length;
    return moreClicks;
  }
}

// Get current trust level
app.get('/api/trust', async (req, res) => {
  try {
    const userHash = getUserHash(req);
    
    // Get all clicks (we'll optimize this later if needed)
    const clicksResult = await pool.query('SELECT direction FROM clicks ORDER BY created_at ASC');
    const clicks = clicksResult.rows;
    
    const trustLevel = calculateTrustLevel(clicks);
    const totalClicks = clicks.length;
    const moreClicks = clicks.filter(c => c.direction === 'more').length;
    
    // Check if user can click (5 minute cooldown)
    let canClick = true;
    let cooldownRemaining = 0;
    
    // Use PostgreSQL to calculate time difference (avoids timezone issues)
    const lastClickResult = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as seconds_ago 
       FROM clicks 
       WHERE user_hash = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userHash]
    );
    
    if (lastClickResult.rows.length > 0) {
      const secondsAgo = parseFloat(lastClickResult.rows[0].seconds_ago);
      const fiveMinutes = 5 * 60; // in seconds
      
      if (secondsAgo < fiveMinutes) {
        canClick = false;
        cooldownRemaining = Math.ceil(fiveMinutes - secondsAgo);
      }
    }
    
    res.json({
      trustLevel,
      totalClicks,
      moreClicks,
      lessClicks: totalClicks - moreClicks,
      canClick,
      cooldownRemaining
    });
  } catch (err) {
    console.error('Error in /api/trust:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit a click
app.post('/api/click', async (req, res) => {
  try {
    const { direction } = req.body;
    const userHash = getUserHash(req);
    
    if (!direction || !['more', 'less'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction' });
    }
    
    // Check cooldown using PostgreSQL to calculate time difference
    const cooldownCheck = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as seconds_ago 
       FROM clicks 
       WHERE user_hash = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userHash]
    );
    
    if (cooldownCheck.rows.length > 0) {
      const secondsAgo = parseFloat(cooldownCheck.rows[0].seconds_ago);
      const fiveMinutes = 5 * 60; // in seconds
      
      if (secondsAgo < fiveMinutes) {
        const cooldownRemaining = Math.ceil(fiveMinutes - secondsAgo);
        return res.status(429).json({ 
          error: 'Cooldown active', 
          cooldownRemaining 
        });
      }
    }
    
    // Insert the click
    await pool.query(
      'INSERT INTO clicks (direction, user_hash) VALUES ($1, $2)',
      [direction, userHash]
    );
    
    // Get updated click count
    const countResult = await pool.query('SELECT COUNT(*) as count FROM clicks');
    const clickCount = parseInt(countResult.rows[0].count);
    
    // Take a snapshot with every vote (for granular time-based history)
    const allClicksResult = await pool.query('SELECT direction FROM clicks ORDER BY created_at ASC');
    const allClicks = allClicksResult.rows;
    const snapshotTrustLevel = calculateTrustLevel(allClicks);
    
    await pool.query(
      'INSERT INTO snapshots (trust_level, total_clicks) VALUES ($1, $2)',
      [snapshotTrustLevel, clickCount]
    );
    
    // Return updated trust level
    const trustLevel = snapshotTrustLevel;
    const totalClicks = allClicks.length;
    const moreClicks = allClicks.filter(c => c.direction === 'more').length;
    
    res.json({
      success: true,
      trustLevel,
      totalClicks,
      moreClicks,
      lessClicks: totalClicks - moreClicks,
      canClick: false,
      cooldownRemaining: 300
    });
  } catch (err) {
    console.error('Error in /api/click:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get history for the chart (returns all snapshots, frontend will aggregate by time)
app.get('/api/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT trust_level, total_clicks, created_at FROM snapshots ORDER BY created_at ASC'
    );
    
    const snapshots = result.rows.map(row => ({
      trust_level: parseFloat(row.trust_level),
      total_clicks: row.total_clicks,
      created_at: row.created_at.toISOString()
    }));
    
    res.json(snapshots);
  } catch (err) {
    console.error('Error in /api/history:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the history page
app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

app.listen(PORT, () => {
  console.log(`🏈 Darnold Trust Meter running at http://localhost:${PORT}`);
});
