// Inject page-level script (so we can hook into window.fetch/XHR)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('page.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Store ALL encounter data we've seen
let encounterCache = new Map(); // key: "name-age", value: encounter object
let pendingProfileCheck = null;

window.getEncounterCache = () => {
    const obj = {};
    for (const [key, value] of encounterCache.entries()) {
        obj[key] = value;
    }
    return obj;
};

// Function to process encounter data and update badge
const processEncounterData = () => {
    const nameEl = document.querySelector('.encounters-story-profile__name');
    const ageEl = document.querySelector('.encounters-story-profile__age');

    console.log(`[DEBUG] Name element: ${nameEl ? nameEl.textContent : 'not found'}`);
    console.log(`[DEBUG] Age element: ${ageEl ? ageEl.textContent : 'not found'}`);

    if (!nameEl || !ageEl) {
        console.warn('[DEBUG] Missing name or age elements');
        return false; // Indicate processing failed
    }

    const name = nameEl.textContent.trim();
    const age = parseInt(ageEl.textContent.replace(',', '').trim(), 10);
    const key = `${name}-${age}`;

    console.log(`[DEBUG] Looking for match: ${name}, ${age}`);
    console.log(`[DEBUG] Cache size: ${encounterCache.size}`);
    console.log(`[DEBUG] Cache keys:`, Array.from(encounterCache.keys()));

    const match = encounterCache.get(key);

    const existingBadge = document.querySelector('#vote-info-badge');
    if (existingBadge) existingBadge.remove();

    const badge = document.createElement('span');
    badge.id = 'vote-info-badge';
    badge.style.marginLeft = '8px';
    badge.style.fontWeight = 'bold';
    badge.style.fontSize = '16px';

    if (!match) {
        badge.textContent = '[NEW PROFILE]';
        badge.style.color = 'blue';
        console.log(`[DEBUG] No match found for ${name}, ${age} - this is a new profile`);
    } else {
        const vote = match.user.their_vote;
        console.log(`[DEBUG] Matched vote for ${name}, ${age}: their_vote=${vote}`);
        if (vote === 1) {
            badge.textContent = '[NOT VOTED]';
            badge.style.color = 'orange';
        } else if (vote === 2) {
            badge.textContent = '[LIKED YOU] ❤️';
            badge.style.color = 'green';
        } else if (vote === 3) {
            badge.textContent = '[REJECTED YOU] 💔';
            badge.style.color = 'red';
        } else {
            badge.textContent = `[UNKNOWN: ${vote}]`;
            badge.style.color = 'gray';
        }
    }

    nameEl.parentElement?.appendChild(badge);
    return true; // Indicate processing succeeded
};

// Function to retry processing with exponential backoff
const retryProcessing = (maxRetries = 5, baseDelay = 100) => {
    let retryCount = 0;

    const tryProcess = () => {
        if (processEncounterData()) {
            console.log('[DEBUG] Successfully processed encounter data');
            return;
        }

        retryCount++;
        if (retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount - 1);
            console.log(`[DEBUG] Retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
            setTimeout(tryProcess, delay);
        } else {
            console.warn('[DEBUG] Max retries reached, giving up');
        }
    };

    tryProcess();
};

// Listen for encounter results from page context
window.addEventListener('bumble_encounter_data', (event) => {
    const results = event.detail;
    console.log('[DEBUG] Received encounter results', results);

    // Update our cache with ALL encounter data we've seen
    results.forEach(encounter => {
        if (encounter?.user?.name && encounter?.user?.age) {
            const key = `${encounter.user.name.trim()}-${encounter.user.age}`;
            const theirVote = encounter.user.their_vote;
            encounterCache.set(key, encounter);
            console.log(`[DEBUG] Cached encounter: ${key} with vote ${theirVote}`);
        }
    });

    console.log(`[DEBUG] Cache now has ${encounterCache.size} encounters`);

    // Try to process immediately with updated cache
    retryProcessing();
});

// Also observe DOM changes to catch when new profiles are loaded
const observer = new MutationObserver((mutations) => {
    // Check if profile elements have been added/changed
    const hasProfileChanges = mutations.some(mutation => {
        return Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                return node.matches && (node.matches('.encounters-story-profile__name') || node.matches('.encounters-story-profile__age') || node.querySelector('.encounters-story-profile__name') || node.querySelector('.encounters-story-profile__age'));
            }
            return false;
        });
    });

    if (hasProfileChanges) {
        console.log('[DEBUG] Profile elements detected, processing with current cache');
        // Small delay to ensure DOM is fully updated
        setTimeout(() => {
            processEncounterData();
        }, 50);
    }
});

// Start observing
observer.observe(document.body, {
    childList: true, subtree: true
});

console.log('[DEBUG] Content script loaded with retry logic and DOM observation');