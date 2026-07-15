# ProxDash — FastAPI homelab dashboard
# Build:  docker build -t proxdash .
# Run:    docker run -p 8080:8080 -v ./data:/data proxdash
FROM python:3.13-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only runtime/build inputs; repository notes and local scratch files never
# enter the image. Rebuild the deterministic browser bundle in-image so a stale
# working-tree artifact cannot make it into a release.
COPY main.py config.yaml.example README.md LICENSE build.sh ./
COPY src ./src
COPY static ./static
RUN ./build.sh

# Persistent data (config.yaml, sessions, sqlite dbs) lives here.
ENV PROXDASH_DATA=/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/', timeout=4).status < 500 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
