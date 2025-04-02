// Set to track processed tabs
const processedTabs = new Set();

// Utility function to create delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Maximum number of retries
const MAX_RETRIES = 3;

// Delay between retries (in ms)
const RETRY_DELAY = 2000;

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
                
                let retryCount = 0;
                while (retryCount < MAX_RETRIES) {
                    try {
                        await attachDebuggerToTab(tab.id);
                        break;
                    } catch (error) {
                        console.error(`Error attaching debugger to tab ${tab.id} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                            await delay(RETRY_DELAY);
                        }
                    }
                }
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
        // Create send command function with retry mechanism
        const sendCommand = {
            send: async (command, params = {}) => {
                let retryCount = 0;
                while (retryCount < MAX_RETRIES) {
                    try {
                        return await new Promise((resolve, reject) => {
                            chrome.debugger.sendCommand({tabId}, command, params, result => {
                                if (chrome.runtime.lastError) {
                                    reject(chrome.runtime.lastError.message);
                                } else {
                                    resolve(result);
                                }
                            });
                        });
                    } catch (error) {
                        console.error(`Error sending command ${command} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                            await delay(RETRY_DELAY);
                        } else {
                            throw error;
                        }
                    }
                }
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
    let retryCount = 0;
    
    while (true) {
        try {
            // Wait before each attempt
            await delay(1000);

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

            if (!challengeNode) {
                retryCount++;
                if (retryCount >= MAX_RETRIES) {
                    console.log('No challenge found after ' + MAX_RETRIES + ' attempts');
                    break;
                }
                continue;
            }

            // Reset retry count on success
            retryCount = 0;

            // Get iframe box model
            const boxModel = await sendCommand.send('DOM.getBoxModel', {
                nodeId: challengeNode.nodeId
            });

            // Calculate click coordinates
            const [x, y, width, height, padding, border, margin] = boxModel.model.content;
            
            const clickX = Math.floor((x + width) / 2);
            const clickY = Math.floor((y + height) / 2);

            // Simulate mouse movement and click with optimized delays
            await delay(500);
            await sendCommand.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: clickX,
                y: clickY
            });

            await delay(500);
            await sendCommand.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: clickX,
                y: clickY,
                button: 'left',
                clickCount: 1
            });

            await delay(500);
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

            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                console.log('Max retries reached');
                break;
            }
        }
    }
}

// Start monitoring tabs with optimized interval
setInterval(handleAllTabs, 5000);