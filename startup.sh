#!/bin/bash

echo "Starting Docker containers..."
docker-compose up -d

echo "Waiting for services to be ready..."
sleep 5

echo ""
echo "Services started. Available at:"
echo "  - API: http://localhost:3000"
echo "  - Frontend: http://localhost:5173"
echo "  - Crawler: http://localhost:8000"
echo "  - MongoDB: mongodb://localhost:27017"
echo "  - Redis: redis://localhost:6379"
echo ""
echo "Use 'docker-compose down' to stop services"
