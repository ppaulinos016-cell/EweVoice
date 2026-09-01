FROM python:3.11-slim

# Installer FFmpeg et Node.js
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs npm && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Dépendances Node.js
COPY package*.json ./
RUN npm install --omit=dev

# Copier le projet
COPY . .

# Port Render
ENV PORT=10000
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

CMD ["node", "server.js"]
