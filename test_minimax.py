import os
import re

from dotenv import load_dotenv
from openai import OpenAI


def main() -> None:
    load_dotenv()

    api_key = os.getenv("MINIMAX_API_KEY")
    if not api_key:
        raise RuntimeError("MINIMAX_API_KEY is not set. Add it to .env first.")

    client = OpenAI(
        base_url=os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com/v1"),
        api_key=api_key,
    )

    response = client.chat.completions.create(
        model=os.getenv("MINIMAX_MODEL", "MiniMax-M2.7"),
        messages=[
            {"role": "user", "content": "Hi, how are you?"},
        ],
    )

    content = response.choices[0].message.content or ""
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
    print(content)


if __name__ == "__main__":
    main()
