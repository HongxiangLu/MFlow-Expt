from fastapi import FastAPI

app = FastAPI(title="cultural-relics-museum-backend")

@app.get("/api/health")
def health():
    return {"data": {"status": "ok"}}
