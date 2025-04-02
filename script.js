// Define allowed origins for security
const allowedOrigins = [
    "https://challenges.cloudflare.com",
    "http://challenges.cloudflare.com"
];

// Set random screen coordinates for mouse events
let screenX = Math.floor(Math.random() * 401) + 800;  // Random X between 800-1200
let screenY = Math.floor(Math.random() * 201) + 400;  // Random Y between 400-600

// Override mouse event coordinates
Object.defineProperty(MouseEvent.prototype, "screenX", {
    value: screenX
});

Object.defineProperty(MouseEvent.prototype, "screenY", {
    value: screenY
});

// Handle messages from Cloudflare challenge iframe
function handleMessage(event) {
    // Check if message is from allowed origin and has event data
    if (event.source !== window && 
        event.origin && 
        event.data?.event && 
        allowedOrigins.includes(event.origin)) {

        // Handle challenge begin/end events
        if (event.data.event === "interactiveBegin" || 
            event.data.event === "interactiveEnd") {
            
            // Forward event to background script
            chrome.runtime.sendMessage({
                action: event.data.event
            });
        }
    }
}

// Listen for messages
window.addEventListener("message", handleMessage);