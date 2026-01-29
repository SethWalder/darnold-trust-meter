const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize or load data
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }
  // Return default data structure
  return {
    clicks: [],        // Array of { direction, userHash, timestamp }
    snapshots: [],     // Array of { trustLevel, totalClicks, timestamp }
    userCooldowns: {}  // { userHash: lastClickTimestamp }
  };
}

// Save data to file
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Calculate trust level based on clicks
// If fewer than 100 votes: start at 50, move 1% per vote
// If 100+ votes: use the last 100 votes as percentages
function calculateTrustLevel(clicks) {
  const totalClicks = clicks.length;
  
  if (totalClicks === 0) {
    return 50; // Start at 50%
  }
  
  if (totalClicks < 100) {
    // Start at 50, each "more" adds 1, each "less" subtracts 1
    const moreClicks = clicks.filter(c => c.direction === 'more').length;
    const lessClicks = totalClicks - moreClicks;
    const trustLevel = 50 + moreClicks - lessClicks;
    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, trustLevel));
  } else {
    // Use last 100 clicks as percentage
    const recentClicks = clicks.slice(-100);
    const moreClicks = recentClicks.filter(c => c.direction === 'more').length;
    return moreClicks; // This is already a percentage since it's out of 100
  }
}

// Load initial data
let data = loadData();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get user hash from IP (for cooldown tracking)
function getUserHash(req) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip + 'darnold-salt').digest('hex').substring(0, 16);
}

// Get current trust level
app.get('/api/trust', (req, res) => {
  const userHash = getUserHash(req);
  
  const trustLevel = calculateTrustLevel(data.clicks);
  const totalClicks = data.clicks.length;
  const moreClicks = data.clicks.filter(c => c.direction === 'more').length;
  
  // Check if user can click (5 minute cooldown)
  let canClick = true;
  let cooldownRemaining = 0;
  
  const lastClickTime = data.userCooldowns[userHash];
  if (lastClickTime) {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (now - lastClickTime < fiveMinutes) {
      canClick = false;
      cooldownRemaining = Math.ceil((fiveMinutes - (now - lastClickTime)) / 1000);
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
});

// Submit a click
app.post('/api/click', (req, res) => {
  const { direction } = req.body;
  const userHash = getUserHash(req);
  
  if (!direction || !['more', 'less'].includes(direction)) {
    return res.status(400).json({ error: 'Invalid direction' });
  }
  
  // Check cooldown
  const lastClickTime = data.userCooldowns[userHash];
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  
  if (lastClickTime && (now - lastClickTime < fiveMinutes)) {
    const cooldownRemaining = Math.ceil((fiveMinutes - (now - lastClickTime)) / 1000);
    return res.status(429).json({ 
      error: 'Cooldown active', 
      cooldownRemaining 
    });
  }
  
  // Add the click
  data.clicks.push({
    direction,
    userHash,
    timestamp: now
  });
  
  // Update user cooldown
  data.userCooldowns[userHash] = now;
  
  // Keep only last 1000 clicks to prevent file from growing too large
  if (data.clicks.length > 1000) {
    data.clicks = data.clicks.slice(-1000);
  }
  
  // Take a snapshot every 10 clicks for the history chart
  if (data.clicks.length % 10 === 0) {
    const trustLevel = calculateTrustLevel(data.clicks);
    
    data.snapshots.push({
      trustLevel,
      totalClicks: data.clicks.length,
      timestamp: now
    });
    
    // Keep only last 500 snapshots
    if (data.snapshots.length > 500) {
      data.snapshots = data.snapshots.slice(-500);
    }
  }
  
  // Save to file
  saveData(data);
  
  // Return updated trust level
  const trustLevel = calculateTrustLevel(data.clicks);
  const totalClicks = data.clicks.length;
  const moreClicks = data.clicks.filter(c => c.direction === 'more').length;
  
  res.json({
    success: true,
    trustLevel,
    totalClicks,
    moreClicks,
    lessClicks: totalClicks - moreClicks,
    canClick: false,
    cooldownRemaining: 300
  });
});

// Get history for the chart
app.get('/api/history', (req, res) => {
  const snapshots = data.snapshots.map(s => ({
    trust_level: s.trustLevel,
    total_clicks: s.totalClicks,
    created_at: new Date(s.timestamp).toISOString()
  }));
  
  res.json(snapshots);
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
