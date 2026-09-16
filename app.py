import os
import json
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from agent import travel_agent

app = FastAPI(title="Agentic Travel Planner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = None

class ToolExecution(BaseModel):
    tool: str
    input: Any
    output: Any

class ChatResponse(BaseModel):
    thread_id: str
    response: str
    tools_used: List[ToolExecution]

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "travel-agent-mcp"}

@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {"messages": [HumanMessage(content=req.message)]}

    async def event_generator():
        yield f"data: {json.dumps({'type': 'init', 'thread_id': thread_id})}\n\n"
        try:
            async for event in travel_agent.astream_events(inputs, config=config, version="v2"):
                kind = event.get("event")
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if hasattr(chunk, "content") and isinstance(chunk.content, str) and chunk.content:
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"
                elif kind == "on_tool_start":
                    tool_name = event.get("name")
                    tool_input = event.get("data", {}).get("input")
                    yield f"data: {json.dumps({'type': 'tool_start', 'tool': tool_name, 'input': tool_input})}\n\n"
                elif kind == "on_tool_end":
                    tool_name = event.get("name")
                    tool_output = str(event.get("data", {}).get("output", ""))
                    yield f"data: {json.dumps({'type': 'tool_end', 'tool': tool_name, 'output': tool_output})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    try:
        inputs = {"messages": [HumanMessage(content=req.message)]}
        result = await travel_agent.ainvoke(inputs, config=config)

        messages = result.get("messages", [])
        final_answer = ""
        tools_used = []

        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and msg.content:
                final_answer = msg.content
                break

        for i, msg in enumerate(messages):
            if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                for tc in msg.tool_calls:
                    tool_name = tc.get("name")
                    tool_args = tc.get("args")
                    tool_id = tc.get("id")
                    tool_output = None
                    for follow_msg in messages[i+1:]:
                        if isinstance(follow_msg, ToolMessage) and getattr(follow_msg, "tool_call_id", None) == tool_id:
                            tool_output = follow_msg.content
                            break
                    tools_used.append(ToolExecution(
                        tool=tool_name,
                        input=tool_args,
                        output=tool_output
                    ))

        return ChatResponse(
            thread_id=thread_id,
            response=final_answer,
            tools_used=tools_used
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
