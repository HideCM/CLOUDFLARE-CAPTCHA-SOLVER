const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const solverState = new Set();
const MAX_RETRIES = 5;
const INITIAL_WAIT = 1000;
const RETRY_DELAY = 500;
const TURNSTILE_SELECTORS = [
    "[src*='challenges.cloudflare.com']",
    "iframe[src*='turnstile']",
    "iframe[data-hcaptcha-widget-id]",
    "iframe[title*='Cloudflare']"
];
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "interactiveBegin" && sender.tab) {
    console.log("[Service Worker] Received start request for tab " + sender.tab.id);
    solverState.add(sender.tab.id);
    try {
      await attachDebuggerToTab(sender.tab.id);
    } catch (error) {
      console.error("[Service Worker] Failed to attach debugger for tab " + sender.tab.id + ":", error);
    }
  }
  if (message.action === "interactiveEnd" && sender.tab) {
    console.log("[Service Worker] Stopping solver for tab " + sender.tab.id);
    stopSolver(sender.tab.id);
  }
  return true;
});
async function attachDebuggerToTab(tabId) {
  return new Promise(resolve => {
    const debuggerClient = {
      send: (command, params) => {
        return new Promise((resolve, reject) => {
          chrome.debugger.sendCommand({
            tabId: tabId
          }, command, params || {}, result => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError.message);
            } else {
              resolve(result);
            }
          });
        });
      }
    };
    chrome.debugger.attach({
      tabId: tabId
    }, "1.3", async () => {
      if (chrome.runtime.lastError) {
        console.log("Error attaching debugger to tab " + tabId + ":", chrome.runtime.lastError.message);
        resolve();
        return;
      }
      console.log("[Service Worker] Debugger attached to tab: " + tabId);
      await debuggerClient.send("DOM.enable");
      await debuggerClient.send("Page.enable");
      await debuggerClient.send("Network.enable");
      await debuggerClient.send("Runtime.enable");
      await debuggerClient.send("Emulation.setFocusEmulationEnabled", {
        enabled: true
      });
      await Solver(debuggerClient, tabId);
      resolve();
    });
  });
}
function stopSolver(tabId) {
  if (solverState.has(tabId)) {
    console.log("[Service Worker] Solver stop requested for tab " + tabId);
    solverState.delete(tabId);
  }
}
async function findTurnstileElements(debuggerClient) {
  const { nodes } = await debuggerClient.send("DOM.getFlattenedDocument", {
    depth: -1,
    pierce: true
  });
  const potentialFrames = nodes.filter(node => 
    node.nodeName === "IFRAME" && (
      (node.attributes || []).some(attr => 
        attr.includes("turnstile") || 
        attr.includes("cloudflare") ||
        attr.includes("cf-") ||
        attr.includes("challenge")
      ) ||
      (node.attributes || []).includes("Widget containing a Cloudflare security challenge")
    )
  );
  return potentialFrames;
}
async function checkForTurnstileError(debuggerClient, frameNodeId) {
  try {
    const result = await debuggerClient.send("DOM.querySelector", {
      nodeId: frameNodeId,
      selector: ".error-text, .trouble-text, [class*='error'], [class*='trouble']"
    });
    if (result && result.nodeId) {
      return true;
    }
  } catch (error) {
    console.log("[Service Worker] Error checking for trouble message:", error);
  }
  return false;
}
async function refreshChallenge(debuggerClient, frameNodeId) {
  try {
    const result = await debuggerClient.send("DOM.querySelector", {
      nodeId: frameNodeId,
      selector: "button[aria-label='Refresh'], .refresh-button, [class*='refresh']"
    });
    if (result && result.nodeId) {
      const boxModel = await debuggerClient.send("DOM.getBoxModel", {
        nodeId: result.nodeId
      });
      if (boxModel && boxModel.model) {
        const [x1, y1, x2, y2, x3, y3, x4, y4] = boxModel.model.content;
        const centerX = Math.floor((x1 + x3) / 2);
        const centerY = Math.floor((y1 + y3) / 2);
        await clickElement(debuggerClient, centerX, centerY);
        await delay(2000);
        return true;
      }
    }
  } catch (error) {
    console.log("[Service Worker] Error refreshing challenge:", error);
  }
  return false;
}
async function simulateRealisticMouseMovement(debuggerClient, startX, startY, endX, endY) {
  const steps = 10;
  const stepX = (endX - startX) / steps;
  const stepY = (endY - startY) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = startX + stepX * i;
    const y = startY + stepY * i;
    await debuggerClient.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x,
      y: y
    });
    await delay(20);
  }
}
async function clickElement(debuggerClient, x, y) {
  await simulateRealisticMouseMovement(
    debuggerClient,
    x - 50,
    y - 50,
    x,
    y
  );
  await debuggerClient.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: x,
    y: y,
    button: "left",
    clickCount: 1
  });
  await delay(50);
  await debuggerClient.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x,
    y: y,
    button: "left",
    clickCount: 1
  });
}
async function Solver(debuggerClient, tabId) {
  let retryCount = 0;
  let lastClickedFrame = null;
  while (solverState.has(tabId) && retryCount < MAX_RETRIES) {
    try {
      await delay(INITIAL_WAIT);
      const frames = await findTurnstileElements(debuggerClient);
      if (frames.length === 0) {
        console.log("[Service Worker] No Turnstile frames found, retrying...");
        retryCount++;
        await delay(RETRY_DELAY);
        continue;
      }
      for (const frame of frames) {
        try {
          if (lastClickedFrame === frame.nodeId) {
            continue;
          }
          const boxModel = await debuggerClient.send("DOM.getBoxModel", {
            nodeId: frame.nodeId
          });
          if (!boxModel?.model?.content) continue;
          const [x1, y1, x2, y2, x3, y3, x4, y4] = boxModel.model.content;
          const centerX = Math.floor((x1 + x3) / 2);
          const centerY = Math.floor((y1 + y3) / 2);
          console.log(`[Service Worker] Attempting to click Turnstile at (${centerX}, ${centerY})`);
          await clickElement(debuggerClient, centerX, centerY);
          lastClickedFrame = frame.nodeId;
          await delay(2000);
          const hasError = await checkForTurnstileError(debuggerClient, frame.nodeId);
          if (hasError) {
            console.log("[Service Worker] Detected Turnstile error, trying to refresh...");
            const refreshed = await refreshChallenge(debuggerClient, frame.nodeId);
            if (refreshed) {
              await delay(2000);
              continue;
            }
          }
          try {
            await debuggerClient.send("DOM.getBoxModel", {
              nodeId: frame.nodeId
            });
          } catch (error) {
            console.log("[Service Worker] Frame disappeared after click, likely successful!");
            return;
          }
        } catch (frameError) {
          console.log("[Service Worker] Error interacting with frame:", frameError);
          continue;
        }
      }
      retryCount++;
      await delay(RETRY_DELAY);
    } catch (error) {
      console.log("[Service Worker] Error solving challenge:", error);
      if (error.includes("No tab with given id")) {
        stopSolver(tabId);
        return;
      }
      if (error.includes("Debugger is not attached to the tab with id:")) {
        const detachedTabId = parseInt(error.split("Debugger is not attached to the tab with id:")[1]);
        await attachDebuggerToTab(detachedTabId);
        return;
      }
      retryCount++;
      await delay(RETRY_DELAY);
    }
  }
  chrome.debugger.detach({
    tabId: tabId
  }, () => {
    if (chrome.runtime.lastError) {
      console.log("[Service Worker] Error detaching debugger:", chrome.runtime.lastError.message);
    } else {
      console.log("[Service Worker] Debugger detached successfully");
    }
  });
}