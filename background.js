// Utility function to create delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Set to track solver state for each tab
const solverState = new Set();

// Maximum number of retries
const MAX_RETRIES = 3;

// Delay between retries (in ms)
const RETRY_DELAY = 2000;

// Listen for messages from content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // Handle start solver request
    if (message.action === 'start' && sender.tab) {
        console.log('[Service Worker] Debugger attached to tab with id:', sender.tab.id);
        solverState.add(sender.tab.id);
        
        let retryCount = 0;
        while (retryCount < MAX_RETRIES) {
            try {
                await attachDebuggerToTab(sender.tab.id);
                break;
            } catch (error) {
                console.error(`[Service Worker] Error attaching debugger to tab ${sender.tab.id} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                    await delay(RETRY_DELAY);
                }
            }
        }
    }
    
    // Handle stop solver request 
    if (message.action === 'stop' && sender.tab) {
        console.log('[Service Worker] Stopping solver for tab ' + sender.tab.id);
        stopSolver(sender.tab.id);
    }
});

// Function to attach debugger to tab
async function attachDebuggerToTab(tabId) {
    return new Promise(resolve => {
        chrome.debugger.attach({tabId}, '1.3', async () => {
            console.log('[Service Worker] Debugger attached to tab:', tabId);
            
            if (chrome.runtime.lastError) {
                console.log('[Service Worker] Error attaching debugger to tab ' + tabId + ':', chrome.runtime.lastError.message);
                resolve();
                return;
            }

            // Enable required domains
            await sendCommand('DOM.enable');
            await sendCommand('Page.enable');
            await sendCommand('Emulation.setFocusEmulationEnabled', {enabled: true});
            
            // Start solver
            await Solver(sendCommand, tabId);
            resolve();
        });
    });
}

// Function to stop solver for a tab
function stopSolver(tabId) {
    if (solverState.has(tabId)) {
        console.log('[Service Worker] Stopping solver for tab:', tabId);
        solverState.delete(tabId);
    }
}

// Main solver function
async function Solver(sendCommand, tabId) {
    let retryCount = 0;
    
    while (true) {
        if (!solverState.has(tabId)) {
            console.log('[Service Worker] Solver stopped for tab ' + tabId + ' (detached)');
            break;
        }

        try {
            // Wait before each attempt
            await delay(1000);

            // Get DOM nodes
            const {nodes} = await sendCommand('DOM.getDocument', {
                depth: -1,
                pierce: true
            });

            // Find Cloudflare challenge iframe
            const challengeNode = nodes.find(node => 
                node.nodeName === 'IFRAME' && 
                node.attributes?.includes('Cloudflare challenge')
            );

            if (!challengeNode) {
                retryCount++;
                if (retryCount >= MAX_RETRIES) {
                    console.log('[Service Worker] No challenge found after ' + MAX_RETRIES + ' attempts');
                    break;
                }
                continue;
            }

            // Reset retry count on success
            retryCount = 0;

            // Get iframe box model
            const boxModel = await sendCommand('DOM.getBoxModel', {
                nodeId: challengeNode.nodeId
            });

            // Calculate click coordinates
            const [x, y, width, height, padding, border, margin] = boxModel.model.content;
            
            const clickX = Math.floor((x + width) / 2);
            const clickY = Math.floor((y + height) / 2);

            // Simulate mouse movement and click with optimized delays
            await delay(500);
            await sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: clickX,
                y: clickY
            });

            await delay(500);
            await sendCommand('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: clickX,
                y: clickY,
                button: 'left',
                clickCount: 1
            });

            await delay(500);
            await sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: clickX,
                y: clickY,
                button: 'left',
                clickCount: 1
            });

            console.log('[Service Worker] Challenge solved for tab ' + tabId + '!');

        } catch (error) {
            console.error('[Service Worker] Error solving challenge for tab ' + tabId + ':', error);
            
            if (error.message.includes('detached')) {
                stopSolver(tabId);
                return;
            }

            if (error.message.includes('tab')) {
                let tabId = parseInt(error.message.split('tab')[1]);
                attachDebuggerToTab(tabId);
                return;
            }

            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                console.log('[Service Worker] Max retries reached for tab ' + tabId);
                break;
            }
        }
    }

    // Cleanup when tab is closed
    chrome.debugger.detach({tabId}, () => {
        if (chrome.runtime.lastError) {
            console.error('[Service Worker] Error detaching debugger from tab ' + tabId + ':', chrome.runtime.lastError.message);
        } else {
            console.log('[Service Worker] Debugger detached from tab ' + tabId + '.');
        }
    });
}

console.log('[Cloudflare Mode] Action:', action);