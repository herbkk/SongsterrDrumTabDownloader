FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (Chromium for Selenium)
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Expose the port the app runs on
EXPOSE 5000

# Run the application
CMD ["python", "app.py"]
