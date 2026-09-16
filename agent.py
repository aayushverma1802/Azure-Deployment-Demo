import os
from dotenv import load_dotenv
from langchain_openai import AzureChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

from mcp_server import search_travel_web, get_weather, calculate_budget

load_dotenv()

@tool
def search_web_travel_tool(query: str) -> str:
    """Searches the live web for travel guides, flights, hotels, attractions, and local insights."""
    return search_travel_web(query)

@tool
def weather_forecast_tool(city: str) -> str:
    """Fetches real-time weather and temperature forecast for any given destination city."""
    return get_weather(city)

@tool
def budget_calculator_tool(destination: str, days: int, travelers: int, travel_style: str = "moderate") -> str:
    """Calculates estimated budget breakdown for accommodation, food, and activities."""
    return calculate_budget(destination=destination, days=days, travelers=travelers, travel_style=travel_style)

tools = [search_web_travel_tool, weather_forecast_tool, budget_calculator_tool]

endpoint = (os.getenv("AZURE_OPENAI_ENDPOINT") or "").strip()
api_key = (os.getenv("AZURE_OPENAI_KEY") or os.getenv("AZURE_OPENAI_API_KEY") or "").strip()
deployment_name = (os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME") or "gpt-4o").strip()
api_version = (os.getenv("AZURE_OPENAI_API_VERSION") or "2024-02-15-preview").strip()

if api_key:
    os.environ["AZURE_OPENAI_API_KEY"] = api_key

llm = AzureChatOpenAI(
    azure_endpoint=endpoint,
    api_key=api_key,
    azure_deployment=deployment_name,
    model=deployment_name,
    api_version=api_version,
    temperature=0.7,
    streaming=True,
)

system_prompt = (
    "You are an expert AI Travel Planner and Agentic Concierge. "
    "Use your tools (web search, live weather, budget calculator) to create comprehensive, realistic, "
    "and delightful travel itineraries. Always check real-time weather when recommending activities, "
    "calculate realistic budgets, and search for up-to-date travel recommendations."
)

memory = MemorySaver()
travel_agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt=system_prompt,
    checkpointer=memory
)
