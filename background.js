const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const solverState = new Set();
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
async function Solver(debuggerClient, tabId) {
  while (true) {
    if (!solverState.has(tabId)) {
      console.log("[Service Worker] Solver for tab " + tabId + " is stopping.");
      break;
    }
    try {
      await delay(500);
      const { nodes } = await debuggerClient.send("DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true
      });
      const challengeFrame = nodes.find(node => 
        node.nodeName === "IFRAME" && 
        node.attributes?.includes("Widget containing a Cloudflare security challenge")
      );
      if (!challengeFrame) {
        continue;
      }
      const boxModel = await debuggerClient.send("DOM.getBoxModel", {
        nodeId: challengeFrame.nodeId
      });
      const [x1, y1, x2, y2, x3, y3, x4, y4] = boxModel.model.content;
      const clickX = (x1 + x3) / 2 - ((x1 + x3) / 2 - x1) / 2;
      const clickY = (y1 + y3) / 2;
      await delay(500);
      await debuggerClient.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: clickX,
        y: clickY
      });
      await delay(10);
      await debuggerClient.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: clickX,
        y: clickY,
        button: "left",
        clickCount: 1
      });
      await delay(10);
      await debuggerClient.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: clickX,
        y: clickY,
        button: "left",
        clickCount: 1
      });
      console.log("[Service Worker] Cloudflare turnstile clicked for tab " + tabId + "!");
    } catch (error) {
      console.log("[Service Worker] Error solving Cloudflare challenge on tab " + tabId + ":", error);
      if (error.includes("No tab with given id ")) {
        stopSolver(tabId);
        return;
      }
      if (error.includes("Debugger is not attached to the tab with id: ")) {
        const detachedTabId = parseInt(error.split("Debugger is not attached to the tab with id: ")[1]);
        await attachDebuggerToTab(detachedTabId);
        return;
      }
    }
  }
  chrome.debugger.detach({
    tabId: tabId
  }, () => {
    if (chrome.runtime.lastError) {
      console.log("[Service Worker] Error detaching debugger from tab " + tabId + ":", chrome.runtime.lastError.message);
    } else {
      console.log("[Service Worker] Debugger detached from tab " + tabId + ".");
    }
  });
}