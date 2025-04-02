// Set to track processed tabs
const processedTabs = new Set();

// Utility function to create delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to handle all tabs
async function handleAllTabs() {
    chrome.tabs.query({}, async tabs => {
        // Check for runtime error
        if (chrome.runtime.lastError) {
            console.log('Runtime error:', chrome.runtime.lastError.message);
            return;
        }

        // Process new tabs
        for (const tab of tabs) {
            if (!processedTabs.has(tab.id) && tab.url && tab.url.startsWith('http')) {
                console.log('Handling new tabId:', tab.id, 'URL:', tab.url);
                processedTabs.add(tab.id);
                attachDebuggerToTab(tab.id);
            }
        }

        // Clean up closed tabs
        const activeTabIds = new Set(tabs.map(tab => tab.id));
        for (const tabId of processedTabs) {
            if (!tabId || !activeTabIds.has(tabId)) {
                processedTabs.delete(tabId);
                console.log('Tab closed, removed from processed list:', tabId);
            }
        }
    });
}

// Function to attach debugger to tab
async function attachDebuggerToTab(tabId) {
    return new Promise(resolve => {
        // Create send command function
        const sendCommand = {
            send: (command, params = {}) => {
                return new Promise((resolve, reject) => {
                    chrome.debugger.sendCommand({tabId}, command, params, result => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError.message);
                        } else {
                            resolve(result);
                        }
                    });
                });
            }
        };

        // Attach debugger
        chrome.debugger.attach({tabId}, '1.3', async () => {
            console.log('Debugger attached to tab:', tabId);

            if (chrome.runtime.lastError) {
                console.log('Error attaching debugger to tab ' + tabId + ':', chrome.runtime.lastError.message);
                resolve();
                return;
            }

            // Enable required domains
            await sendCommand.send('DOM.enable');
            await sendCommand.send('Page.enable');
            
            // Start solver
            await Solver(sendCommand);
            resolve();
        });
    });
}

// Main solver function
async function Solver(sendCommand) {
    while (true) {
        try {
            // Wait before each attempt
            await delay(2000);

            // Get DOM nodes
            const {nodes} = await sendCommand.send('DOM.getDocument', {
                depth: -1,
                pierce: true
            });

            // Find Cloudflare challenge iframe
            const challengeNode = nodes.find(node => 
                node.nodeName === 'IFRAME' && 
                node.attributes?.includes('Cloudflare challenge')
            );

            if (!challengeNode) continue;

            // Get iframe box model
            const boxModel = await sendCommand.send('DOM.getBoxModel', {
                nodeId: challengeNode.nodeId
            });

            // Calculate click coordinates
            const [x, y, width, height, padding, border, margin] = boxModel.model.content;
            
            const clickX = Math.floor((x + width) / 2);
            const clickY = Math.floor((y + height) / 2);

            // Simulate mouse movement and click
            await delay(1000);
            await sendCommand.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: clickX,
                y: clickY
            });

            await delay(1000);
            await sendCommand.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: clickX,
                y: clickY,
                button: 'left',
                clickCount: 1
            });

            await delay(1000);
            await sendCommand.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: clickX,
                y: clickY,
                button: 'left',
                clickCount: 1
            });

            console.log('Widget clicked!');

        } catch (error) {
            console.log('Error solving challenge:', error);
            if (error.includes('detached')) return;
        }
    }
}

// Start monitoring tabs
setInterval(handleAllTabs, 5000);

// Define allowed origins for Cloudflare challenges
const allowedOrigins = [
    'http://challenges.cloudflare.com',
    'https://challenges.cloudflare.com'
];

// Function to generate random integer between min and max
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Generate random screen coordinates
let screenX = getRandomInt(-1000, 2000);
let screenY = getRandomInt(-1000, 2000);

// Override MouseEvent prototype properties
Object.defineProperty(MouseEvent.prototype, 'screenX', {
    'value': screenX
});
Object.defineProperty(MouseEvent.prototype, 'screenY', {
    'value': screenY
});

// Message handler function
function handleMessage(event) {
    // Check if message is from window and has data
    if (event.source !== window && event.data && event.data?.action) {
        // Check if origin is allowed
        if (allowedOrigins.includes(event.origin)) {
            // Check if action is start or stop
            if (event.data.action === 'start' || event.data.action === 'stop') {
                // Send message to background script
                chrome.runtime.sendMessage({
                    'action': event.data.action
                });
            }
        }
    }
}

// Add message event listener
window.addEventListener('message', handleMessage);