"""Macoostudy Career Agent: Claim-to-Evidence Engine.

resume claim -> targeted question -> candidate answer -> evidence extraction
-> rubric evaluation -> claim status -> remediation
"""
from .provider import get_provider
from .routes import create_blueprint
from .service import CareerAgent


def init_app(app, get_db, new_id, groq_client=None, groq_model_resolver=None):
    factory = lambda: get_provider(groq_client, groq_model_resolver)
    agent = CareerAgent(get_db, new_id, factory)
    agent.init_db()
    active = factory().describe()
    print(f"[CareerAgent] active provider: {active['label']}" + ("" if active["is_llm"] else f" ({active.get('reason')})"))
    app.register_blueprint(create_blueprint(agent, lambda: factory().describe()))
    app.extensions["career_agent"] = agent
    return agent
