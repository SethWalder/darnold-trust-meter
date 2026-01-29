// DOM Elements
const needle = document.getElementById('needle');
const btnLess = document.getElementById('btn-less');
const btnMore = document.getElementById('btn-more');
const cooldownNotice = document.getElementById('cooldown-notice');
const cooldownTime = document.getElementById('cooldown-time');

// State
let currentTrustLevel = 50;
let canClick = false;
let cooldownInterval = null;

// Convert trust level (0-100) to needle angle (-90 to 90 degrees)
function trustToAngle(trust) {
  // 0% trust = -90 degrees (left)
  // 100% trust = 90 degrees (right)
  return (trust / 100) * 180 - 90;
}

// Update the needle position
function updateNeedle(trustLevel, animate = true) {
  const angle = trustToAngle(trustLevel);
  
  if (animate) {
    // Smooth transition
    needle.style.transition = 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';
  } else {
    needle.style.transition = 'none';
  }
  
  // Update CSS custom property for jitter animation
  needle.style.setProperty('--needle-angle', `${angle}deg`);
  needle.style.transform = `rotate(${angle}deg)`;
  
  // Update Darnold background opacity based on trust level
  // At 0% trust = 0.03 opacity (nearly invisible)
  // At 100% trust = 0.45 opacity (quite visible)
  const darnoldOpacity = 0.03 + (trustLevel / 100) * 0.42;
  document.documentElement.style.setProperty('--darnold-opacity', darnoldOpacity);
  
  currentTrustLevel = trustLevel;
}

// Format seconds to MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Start cooldown timer
function startCooldown(seconds) {
  canClick = false;
  btnLess.disabled = true;
  btnMore.disabled = true;
  cooldownNotice.classList.remove('hidden');
  
  let remaining = seconds;
  cooldownTime.textContent = formatTime(remaining);
  
  if (cooldownInterval) {
    clearInterval(cooldownInterval);
  }
  
  cooldownInterval = setInterval(() => {
    remaining--;
    cooldownTime.textContent = formatTime(remaining);
    
    if (remaining <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      endCooldown();
    }
  }, 1000);
}

// End cooldown
function endCooldown() {
  canClick = true;
  btnLess.disabled = false;
  btnMore.disabled = false;
  cooldownNotice.classList.add('hidden');
}

// Fetch current trust level from server
async function fetchTrustLevel() {
  try {
    const response = await fetch('/api/trust');
    const data = await response.json();
    
    updateNeedle(data.trustLevel);
    
    if (data.canClick) {
      endCooldown();
    } else {
      startCooldown(data.cooldownRemaining);
    }
  } catch (error) {
    console.error('Failed to fetch trust level:', error);
  }
}

// Submit a vote
async function submitVote(direction) {
  if (!canClick) return;
  
  // Optimistic UI update
  btnLess.disabled = true;
  btnMore.disabled = true;
  
  try {
    const response = await fetch('/api/click', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ direction })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      updateNeedle(data.trustLevel);
      startCooldown(data.cooldownRemaining);
    } else if (response.status === 429) {
      // Rate limited
      startCooldown(data.cooldownRemaining);
    }
  } catch (error) {
    console.error('Failed to submit vote:', error);
    // Re-enable buttons on error
    if (canClick) {
      btnLess.disabled = false;
      btnMore.disabled = false;
    }
  }
}

// Event listeners
btnLess.addEventListener('click', () => submitVote('less'));
btnMore.addEventListener('click', () => submitVote('more'));

// Poll for updates every 10 seconds to see other users' votes
setInterval(fetchTrustLevel, 10000);

// Initial load
fetchTrustLevel();
