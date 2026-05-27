FROM python:3.14-slim

WORKDIR /app

COPY crawler/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY crawler/ .

EXPOSE 8000

CMD ["python", "server.py"]
