/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// ============================================================================
// DOM Elements
// ============================================================================
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// ============================================================================
// Chat State
// ============================================================================
const chatState = {
	history: [
		{
			role: "assistant",
			content:
				"Halo! Saya adalah aplikasi obrolan LLM yang didukung oleh Zayin AI. Bagaimana saya dapat membantu Anda hari ini?",
		},
	],
	isProcessing: false,
};

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Auto-resize textarea as user types
 */
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

/**
 * Send message on Enter key (without Shift)
 */
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

/**
 * Send button click handler
 */
sendButton.addEventListener("click", sendMessage);

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Sends a message to the chat API and processes the response.
 * Supports numeric responses and streaming data.
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages or if already processing
	if (!message || chatState.isProcessing) return;

	// Update state and disable UI
	chatState.isProcessing = true;
	updateUIState(true);

	// Add user message to chat
	addMessageToChat("user", message);

	// Clear and reset input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add message to history
	chatState.history.push({ role: "user", content: message });

	try {
		// Create placeholder for assistant response
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";
		assistantMessageEl.innerHTML = "<p></p>";
		chatMessages.appendChild(assistantMessageEl);
		const assistantTextEl = assistantMessageEl.querySelector("p");

		// Scroll to bottom
		scrollToBottom();

		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: chatState.history }),
		});

		// Validate response
		if (!response.ok) {
			throw new Error(`API Error: ${response.statusText}`);
		}
		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Process streaming response
		await processStreamingResponse(response, assistantTextEl);

		// Add completed response to chat history
		const assistantContent = assistantTextEl.textContent;
		if (assistantContent) {
			chatState.history.push({ role: "assistant", content: assistantContent });
		}
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"assistant",
			"Maaf, terjadi kesalahan saat memproses permintaan Anda."
		);
	} finally {
		// Clean up and re-enable UI
		typingIndicator.classList.remove("visible");
		chatState.isProcessing = false;
		updateUIState(false);
		userInput.focus();
	}
}

/**
 * Processes streaming response from API
 * Supports numeric responses and multiple API formats
 *
 * @param {Response} response - The fetch response object
 * @param {HTMLElement} assistantTextEl - Element to display the response
 */
async function processStreamingResponse(response, assistantTextEl) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();

	let responseText = "";
	let buffer = "";
	let sawDone = false;

	const updateDisplay = () => {
		assistantTextEl.textContent = responseText;
		scrollToBottom();
	};

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			// Process remaining events in buffer
			const { events } = consumeSseEvents(buffer + "\n\n");
			for (const data of events) {
				if (data === "[DONE]") break;
				const content = extractContentFromEvent(data);
				if (content) {
					responseText += content;
					updateDisplay();
				}
			}
			break;
		}

		// Decode and buffer new data
		buffer += decoder.decode(value, { stream: true });
		const { events, buffer: newBuffer } = consumeSseEvents(buffer);
		buffer = newBuffer;

		// Process all complete events
		for (const data of events) {
			if (data === "[DONE]") {
				sawDone = true;
				buffer = "";
				break;
			}

			const content = extractContentFromEvent(data);
			if (content) {
				responseText += content;
				updateDisplay();
			}
		}

		if (sawDone) break;
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts content from API response event
 * Supports multiple formats and numeric responses:
 * - Workers AI: { response: "text" } or { response: 42 }
 * - OpenAI: { choices: [{ delta: { content: "text" } }] }
 * - Anthropic: { delta: { text: "text" } }
 * - Generic: { text, data, or message fields }
 *
 * @param {string} data - Raw event data string
 * @returns {string} Extracted content or empty string
 */
function extractContentFromEvent(data) {
	try {
		const jsonData = JSON.parse(data);

		// Workers AI format: { response: "..." } - handle both string and number
		if (jsonData.response !== undefined && jsonData.response !== null) {
			const responseValue = String(jsonData.response).trim();
			if (responseValue.length > 0 && responseValue !== "0") {
				return responseValue;
			}
		}

		// OpenAI format: { choices: [{ delta: { content: "..." } }] }
		if (jsonData.choices?.[0]?.delta?.content) {
			return jsonData.choices[0].delta.content;
		}

		// Anthropic format: { delta: { text: "..." } }
		if (jsonData.delta?.text) {
			return jsonData.delta.text;
		}

		// Generic text field
		if (typeof jsonData.text === "string" && jsonData.text.length > 0) {
			return jsonData.text;
		}

		// Generic data field
		if (typeof jsonData.data === "string" && jsonData.data.length > 0) {
			return jsonData.data;
		}

		// Generic message field
		if (typeof jsonData.message === "string" && jsonData.message.length > 0) {
			return jsonData.message;
		}

		// Plain string response
		if (typeof jsonData === "string" && jsonData.length > 0) {
			return jsonData;
		}

		return "";
	} catch (e) {
		console.warn("Error parsing SSE data as JSON:", e);
		return "";
	}
}

/**
 * Adds a message to the chat display
 *
 * @param {string} role - Message role: "user" or "assistant"
 * @param {string} content - Message content
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;
	messageEl.innerHTML = `<p>${escapeHtml(content)}</p>`;
	chatMessages.appendChild(messageEl);
	scrollToBottom();
}

/**
 * Escapes HTML special characters to prevent XSS vulnerabilities
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for innerHTML
 */
function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Scrolls chat messages container to the bottom
 */
function scrollToBottom() {
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Updates the UI state during API processing
 *
 * @param {boolean} isDisabled - Whether to disable input UI elements
 */
function updateUIState(isDisabled) {
	userInput.disabled = isDisabled;
	sendButton.disabled = isDisabled;
}

/**
 * Consumes SSE (Server-Sent Events) format events from a buffer
 * Properly handles CRLF and LF line endings
 *
 * @param {string} buffer - Raw SSE buffer data
 * @returns {Object} Object with events array and remaining buffer
 */
function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;

	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];

		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}

		if (dataLines.length > 0) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, buffer: normalized };
}
