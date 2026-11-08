"""Push the guardrails' messages to the customer's phone through ntfy (https://ntfy.sh), a free push app.

Set NTFY_TOPIC in .env and subscribe to the same topic in the ntfy app on the phone. Without it, nothing
is sent and the messages still appear in the engine's Agent activity. Sending never blocks a purchase.
"""
from __future__ import annotations

import os
import threading

import httpx


def push(text: str, title: str = "Guardrails", tags: str = "warning") -> bool:
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        return False

    def send():
        try:
            httpx.post(f"https://ntfy.sh/{topic}", content=text.encode(), timeout=10,
                       headers={"Title": title, "Tags": tags, "Priority": "high"})
        except Exception:
            pass

    threading.Thread(target=send, daemon=True).start()
    return True
