FROM python:3.14-slim

WORKDIR /app

COPY crawler/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright system dependencies and use system-installed browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    firefox-esr \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libxss1 \
    libappindicator3-1 \
    libindicator7 \
    fonts-dejavu \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Set environment to use system browsers
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY crawler/ .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "server.py"]
