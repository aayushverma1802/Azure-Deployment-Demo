let threadId = localStorage.getItem("travel_agent_thread_id") || null;

const messagesContainer = document.getElementById("messages-container");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const welcomeCard = document.getElementById("welcome-card");

function initTheme() {
  const savedTheme = localStorage.getItem("travel_agent_theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("travel_agent_theme", next);
}

initTheme();

function applySuggestion(text) {
  userInput.value = text;
  userInput.focus();
  adjustTextareaHeight();
}

function handleKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSend(event);
  }
}

function adjustTextareaHeight() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
}

userInput.addEventListener("input", adjustTextareaHeight);

function clearConversation() {
  localStorage.removeItem("travel_agent_thread_id");
  threadId = null;
  messagesContainer.innerHTML = "";
  if (welcomeCard) {
    welcomeCard.style.display = "block";
    messagesContainer.appendChild(welcomeCard);
  }
}

async function handleSend(event) {
  if (event) event.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  if (welcomeCard) {
    welcomeCard.style.display = "none";
  }

  appendMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  userInput.disabled = true;
  sendBtn.disabled = true;

  const botMsgElements = createBotMessageStreamContainer();
  const { toolsDiv, bubble } = botMsgElements;
  let fullText = "";

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, thread_id: threadId }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop();

      for (const block of lines) {
        if (!block.startsWith("data: ")) continue;
        const jsonStr = block.replace("data: ", "").trim();
        if (!jsonStr) continue;

        try {
          const payload = JSON.parse(jsonStr);

          if (payload.type === "init") {
            threadId = payload.thread_id;
            localStorage.setItem("travel_agent_thread_id", threadId);
          } else if (payload.type === "tool_start") {
            const badge = document.createElement("div");
            badge.className = "tool-badge";
            badge.id = `tool-${payload.tool}`;
            badge.textContent = `MCP: Executing ${payload.tool}...`;
            toolsDiv.appendChild(badge);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          } else if (payload.type === "tool_end") {
            const badge = document.getElementById(`tool-${payload.tool}`);
            if (badge) {
              badge.textContent = `MCP: Completed ${payload.tool}`;
              badge.style.borderColor = "#22c55e";
              badge.style.color = "#16a34a";
            }
          } else if (payload.type === "token") {
            fullText += payload.content;
            if (typeof marked !== "undefined") {
              bubble.innerHTML = marked.parse(fullText);
            } else {
              bubble.textContent = fullText;
            }
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          } else if (payload.type === "error") {
            fullText += `\n\nError: ${payload.error}`;
            bubble.textContent = fullText;
          }
        } catch (err) {
          console.error("JSON parse error:", err);
        }
      }
    }
  } catch (error) {
    bubble.textContent = `An error occurred: ${error.message}`;
  } finally {
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

function appendMessage(sender, text) {
  const msgWrapper = document.createElement("div");
  msgWrapper.className = `message ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  msgWrapper.appendChild(bubble);
  messagesContainer.appendChild(msgWrapper);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createBotMessageStreamContainer() {
  const msgWrapper = document.createElement("div");
  msgWrapper.className = "message bot";

  const toolsDiv = document.createElement("div");
  toolsDiv.className = "tool-logs";
  msgWrapper.appendChild(toolsDiv);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = `<span class="loading-dots"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></span>`;
  msgWrapper.appendChild(bubble);

  messagesContainer.appendChild(msgWrapper);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return { toolsDiv, bubble };
}
