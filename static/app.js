let threadId = localStorage.getItem("travel_agent_thread_id") || null;
let sending = false;

const messagesContainer = document.getElementById("messages-container");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const welcomeCard = document.getElementById("welcome-card");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebar-overlay");
const menuBtn = document.getElementById("menu-btn");
const closeSidebarBtn = document.getElementById("close-sidebar");

if (typeof marked !== "undefined") {
  marked.setOptions({ gfm: true, breaks: true });
}

function initTheme() {
  document.documentElement.setAttribute(
    "data-theme",
    localStorage.getItem("travel_agent_theme") || "light"
  );
}

function toggleTheme() {
  const next = (document.documentElement.getAttribute("data-theme") || "light") === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("travel_agent_theme", next);
}

function setSidebarOpen(open) {
  sidebar.classList.toggle("open", open);
  overlay.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
}

menuBtn?.addEventListener("click", () => setSidebarOpen(true));
closeSidebarBtn?.addEventListener("click", () => setSidebarOpen(false));
overlay?.addEventListener("click", () => setSidebarOpen(false));
window.addEventListener("resize", () => {
  if (window.innerWidth > 860) setSidebarOpen(false);
});

initTheme();

function applySuggestion(text) {
  userInput.value = text;
  userInput.focus();
  adjustTextareaHeight();
  setSidebarOpen(false);
}

function handleKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSend(event);
  }
}

function adjustTextareaHeight() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
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
  setSidebarOpen(false);
  userInput.focus();
}

function nearBottom() {
  const slack = 80;
  return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < slack;
}

function scrollIfNeeded(force) {
  if (force || nearBottom()) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderStreaming(bubble, text) {
  bubble.innerHTML = `${escapeHtml(text).replace(/\n/g, "<br>")}<span class="stream-caret"></span>`;
}

function renderMarkdown(bubble, text) {
  if (typeof marked !== "undefined") {
    bubble.innerHTML = marked.parse(text);
  } else {
    bubble.textContent = text;
  }
}

async function handleSend(event) {
  if (event) event.preventDefault();
  if (sending) return;

  const text = userInput.value.trim();
  if (!text) return;

  sending = true;
  if (welcomeCard) welcomeCard.style.display = "none";

  appendMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  userInput.disabled = true;
  sendBtn.disabled = true;

  const { toolsDiv, bubble } = createBotMessageStreamContainer();
  const toolBadges = new Map();
  let fullText = "";
  let pending = "";
  let rafId = 0;

  const flush = (force) => {
    if (!pending && !force) return;
    fullText += pending;
    pending = "";
    renderStreaming(bubble, fullText);
    scrollIfNeeded();
  };

  const queueToken = (chunk) => {
    pending += chunk;
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        flush();
      });
    }
  };

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message: text, thread_id: threadId }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Server returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop();

      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(6).trim();
        if (!jsonStr) continue;

        let payload;
        try {
          payload = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (payload.type === "init") {
          threadId = payload.thread_id;
          localStorage.setItem("travel_agent_thread_id", threadId);
        } else if (payload.type === "tool_start") {
          const id = `tool-${payload.tool}-${toolBadges.size}`;
          const badge = document.createElement("div");
          badge.className = "tool-badge";
          badge.textContent = `Running ${payload.tool.replace(/_/g, " ")}`;
          toolsDiv.appendChild(badge);
          toolBadges.set(payload.tool, badge);
          scrollIfNeeded(true);
        } else if (payload.type === "tool_end") {
          const badge = toolBadges.get(payload.tool);
          if (badge) {
            badge.classList.add("done");
            badge.textContent = `Done ${payload.tool.replace(/_/g, " ")}`;
          }
        } else if (payload.type === "token") {
          queueToken(payload.content || "");
        } else if (payload.type === "error") {
          flush(true);
          fullText += `${fullText ? "\n\n" : ""}Error: ${payload.error}`;
          bubble.textContent = fullText;
        } else if (payload.type === "done") {
          flush(true);
        }
      }
    }

    if (rafId) cancelAnimationFrame(rafId);
    flush(true);
    if (fullText) renderMarkdown(bubble, fullText);
    else if (!bubble.textContent) bubble.textContent = "No response generated. Try again.";
  } catch (error) {
    bubble.textContent = `An error occurred: ${error.message}`;
  } finally {
    sending = false;
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
    scrollIfNeeded(true);
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
  scrollIfNeeded(true);
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
  scrollIfNeeded(true);
  return { toolsDiv, bubble };
}
