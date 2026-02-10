const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection with increased pool size for higher traffic
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 40, // Increased for high traffic
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000 // Fail fast if can't get connection
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
      CREATE INDEX IF NOT EXISTS idx_clicks_user_hash ON clicks(user_hash);
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
  }
}

initializeDatabase();

// In-memory cache for current trust level (to avoid recalculating constantly)
let cachedTrustData = {
  trustLevel: 50,
  totalClicks: 0,
  moreClicks: 0,
  lastUpdated: 0
};

// Update cache (optionally pass totalClicks to avoid duplicate COUNT query)
async function updateTrustCache(knownTotalClicks = null) {
  try {
    // Only get last 100 clicks for trust calculation (much faster)
    const clicksResult = await pool.query(
      'SELECT direction FROM clicks ORDER BY created_at DESC LIMIT 100'
    );
    const recentClicks = clicksResult.rows.reverse(); // Put back in chronological order
    
    // Use provided count or fetch it
    let totalClicks;
    if (knownTotalClicks !== null) {
      totalClicks = knownTotalClicks;
    } else {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM clicks');
      totalClicks = parseInt(countResult.rows[0].count);
    }
    
    const trustLevel = calculateTrustLevel(recentClicks, totalClicks);
    const moreClicks = recentClicks.filter(c => c.direction === 'more').length;
    
    cachedTrustData = {
      trustLevel,
      totalClicks,
      moreClicks,
      lastUpdated: Date.now()
    };
  } catch (err) {
    console.error('Error updating trust cache:', err);
  }
}


// Initialize cache on startup
updateTrustCache();

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

// Calculate trust level based on clicks (optimized for large datasets)
// If fewer than 100 votes: start at 50, move 1% per vote
// If 100+ votes: use the last 100 votes as percentages
function calculateTrustLevel(recentClicks, totalClicks) {
  // If only one argument passed (backwards compatibility)
  if (totalClicks === undefined) {
    totalClicks = recentClicks.length;
  }
  
  if (totalClicks === 0) {
    return 50;
  }
  
  if (totalClicks < 100) {
    const moreClicks = recentClicks.filter(c => c.direction === 'more').length;
    const lessClicks = totalClicks - moreClicks;
    return Math.max(0, Math.min(100, 50 + moreClicks - lessClicks));
  } else {
    // Use last 100 clicks as percentage
    const moreClicks = recentClicks.filter(c => c.direction === 'more').length;
    return moreClicks;
  }
}

// Lightweight endpoint for polling - NO database hit, just returns cached data
// Used for background polling to see other users' votes
app.get('/api/trust-poll', (req, res) => {
  const { trustLevel, totalClicks, moreClicks } = cachedTrustData;
  res.json({
    trustLevel,
    totalClicks,
    moreClicks,
    lessClicks: totalClicks - moreClicks
  });
});

// Get current trust level with cooldown check (uses cache + DB for cooldown)
// Used on initial page load and after voting
app.get('/api/trust', async (req, res) => {
  try {
    const userHash = getUserHash(req);
    
    // Use cached trust data (updated on each vote)
    const { trustLevel, totalClicks, moreClicks } = cachedTrustData;
    
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
    
    // Update the cache with new vote (pass count to avoid duplicate query)
    await updateTrustCache(clickCount);
    
    // Take a snapshot with every vote (for granular time-based history)
    await pool.query(
      'INSERT INTO snapshots (trust_level, total_clicks) VALUES ($1, $2)',
      [cachedTrustData.trustLevel, clickCount]
    );
    
    // Return updated trust level from cache
    const { trustLevel, totalClicks, moreClicks } = cachedTrustData;
    
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

// Get history for the chart (returns recent snapshots, frontend will aggregate by time)
app.get('/api/history', async (req, res) => {
  try {
    // Fetch last 24 hours PLUS Super Bowl time range using UNION for better performance
    const result = await pool.query(
      `(SELECT trust_level, total_clicks, created_at 
        FROM snapshots 
        WHERE created_at > NOW() - INTERVAL '24 hours')
       UNION
       (SELECT trust_level, total_clicks, created_at 
        FROM snapshots 
        WHERE created_at >= '2026-02-08 18:30:00-05' 
          AND created_at <= '2026-02-08 22:23:00-05')
       ORDER BY created_at ASC`
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
